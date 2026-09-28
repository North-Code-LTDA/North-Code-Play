import { XtreamCredentials } from "../types";

/**
 * Normalizes an Xtream server URL:
 * - Fixes single slash protocols (e.g. "http:/example.com" -> "http://example.com")
 * - Prepends http:// if protocol is missing
 * - Preserves explicit ports (e.g. "example.com:8080")
 * - Strips trailing slashes
 * - Returns canonical "http(s)://host(:port)"
 */
export function normalizeServerUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  let trimmed = rawUrl.trim();

  // Fix single slash after protocol: http:/example -> http://example
  trimmed = trimmed.replace(/^(https?):\/(?!\/)/i, "$1://");

  // If protocol is missing, add http://
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }

  // Remove trailing slashes
  trimmed = trimmed.replace(/\/+$/, "");

  try {
    const parsed = new URL(trimmed);
    // parsed.host includes port if specified (e.g. "example.com:8080")
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return trimmed;
  }
}

/**
 * Transforms HTTP/HTTPS image URLs (covers, channel logos, backdrops) into
 * same-origin HTTPS URLs via /api/media/image to prevent Mixed Content blocking.
 * If the image is empty, DNS is unavailable, or the URL is invalid, returns the fallback image.
 */
export function getProxiedImageUrl(rawUrl?: string | null): string {
  if (!rawUrl || typeof rawUrl !== "string") {
    return "/api/media/image?fallback=1";
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "/api/media/image?fallback=1";
  }

  // Preserve data URLs and blob URLs
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
    return trimmed;
  }

  // Already proxied
  if (trimmed.startsWith("/api/media/image")) {
    return trimmed;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return `/api/media/image?url=${encodeURIComponent(trimmed)}`;
  }

  return "/api/media/image?fallback=1";
}

export interface FormatValidationResult {
  isPlayable: boolean;
  format: string;
  warning?: string;
  error?: string;
}

/**
 * Validates whether a requested format is playable in standard web browsers.
 * - Live: natively prefers HLS (.m3u8). If only raw .ts is offered, flags it so the server can remux via FFmpeg.
 * - VOD / Series: MP4/WebM are natively supported in web browsers. MKV/AVI/FLV lack native codec support in browsers without remux.
 */
export function validatePlayableFormat(
  type: "live" | "movie" | "series",
  options: {
    containerExtension?: string;
    allowedOutputFormats?: string[];
    requireNative?: boolean;
  } = {}
): FormatValidationResult {
  const { containerExtension, allowedOutputFormats, requireNative = false } = options;

  if (type === "live") {
    if (allowedOutputFormats && Array.isArray(allowedOutputFormats) && allowedOutputFormats.length > 0) {
      const lowerFormats = allowedOutputFormats.map((f) => String(f).toLowerCase());
      const hasM3u8 = lowerFormats.includes("m3u8");
      const hasOnlyTs = lowerFormats.includes("ts") && !hasM3u8;

      if (hasOnlyTs) {
        if (requireNative) {
          return {
            isPlayable: false,
            format: "ts",
            error:
              "O provedor oferece exclusivamente o formato MPEG-TS (.ts) para canais ao vivo, sem lista HLS (.m3u8). Navegadores não reproduzem .ts diretamente sem remux no servidor.",
          };
        }
        return {
          isPlayable: true,
          format: "ts", // Direct .ts selection: creates ticket with ext: "ts" and routes directly to FFmpeg live remux
          warning:
            "O provedor transmite em formato MPEG-TS (.ts). A reprodução no navegador utiliza remuxing em tempo real para HLS pelo servidor (FFmpeg).",
        };
      }
    }

    return {
      isPlayable: true,
      format: "m3u8",
    };
  }

  // VOD / Series
  const ext = (containerExtension || "mp4").toLowerCase().replace(/^\./, "");
  const nativeBrowserFormats = ["mp4", "m4v", "webm"];

  if (!nativeBrowserFormats.includes(ext)) {
    return {
      isPlayable: true,
      format: ext,
      warning: `O contêiner (.${ext}) pode não ser reproduzível nativamente neste navegador. O formato nativo padrão é MP4.`,
    };
  }

  return {
    isPlayable: true,
    format: ext,
  };
}

// In-memory cache for media tickets on the client to avoid repeated POST requests
const mediaTicketCache = new Map<string, { streamUrl: string; expiresAt: number }>();

export interface RequestMediaUrlOptions {
  type: "live" | "movie" | "series";
  streamId: string | number;
  containerExtension?: string;
  allowedOutputFormats?: string[];
}

/**
 * Requests a same-origin HTTPS media URL from Express.
 * CRITICAL: NEVER silently falls back to direct raw HTTP/HTTPS URLs.
 * If ticket creation fails, throws the real error message so the UI can display it with a retry option.
 */
export async function getMediaStreamUrl(
  credentials: XtreamCredentials,
  options: RequestMediaUrlOptions
): Promise<string> {
  const { type, streamId, containerExtension, allowedOutputFormats } = options;
  const cleanServerUrl = normalizeServerUrl(credentials.serverUrl);

  const formatCheck = validatePlayableFormat(type, { containerExtension, allowedOutputFormats });

  const ext = formatCheck.format;
  const cacheKey = `${cleanServerUrl}:${type}:${streamId}:${ext}`;
  const now = Date.now();

  const cached = mediaTicketCache.get(cacheKey);
  if (cached && now < cached.expiresAt) {
    return cached.streamUrl;
  }

  let response: Response;
  try {
    response = await fetch("/api/media/ticket", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        serverUrl: cleanServerUrl,
        username: credentials.username,
        password: credentials.password,
        type,
        streamId: String(streamId),
        ext,
      }),
    });
  } catch (err: any) {
    throw new Error(
      `Falha ao conectar com o serviço de mídia: ${err?.message || "Sem resposta do servidor"}`
    );
  }

  if (!response.ok) {
    let message = `Erro no serviço de mídia (${response.status})`;
    try {
      const errData = await response.json();
      if (errData && errData.message) {
        message = errData.message;
      }
    } catch {
      // Fallback
    }
    throw new Error(message);
  }

  const data = await response.json();
  const streamUrl: string = data.streamUrl;

  if (!streamUrl || !streamUrl.startsWith("/api/media/")) {
    throw new Error("O servidor retornou uma rota de mídia inválida.");
  }

  // Cache ticket for 30 minutes
  mediaTicketCache.set(cacheKey, {
    streamUrl,
    expiresAt: now + 1800 * 1000,
  });

  return streamUrl;
}
