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

export interface FormatValidationResult {
  isPlayable: boolean;
  format: string;
  warning?: string;
  error?: string;
}

/**
 * Validates whether a requested format is playable in standard web browsers.
 * - Live: requires HLS (.m3u8). If provider only offers raw .ts or rtmp, warns/fails with clear message.
 * - VOD / Series: MP4 is natively supported. MKV/AVI/FLV lack native browser codec support.
 */
export function validatePlayableFormat(
  type: "live" | "movie" | "series",
  options: {
    containerExtension?: string;
    allowedOutputFormats?: string[];
  } = {}
): FormatValidationResult {
  const { containerExtension, allowedOutputFormats } = options;

  if (type === "live") {
    // If provider explicitly specifies allowed output formats
    if (allowedOutputFormats && Array.isArray(allowedOutputFormats) && allowedOutputFormats.length > 0) {
      const lowerFormats = allowedOutputFormats.map((f) => String(f).toLowerCase());
      const hasM3u8 = lowerFormats.includes("m3u8");
      const hasOnlyTs = lowerFormats.includes("ts") && !hasM3u8;

      if (hasOnlyTs) {
        return {
          isPlayable: false,
          format: "ts",
          error:
            "O provedor oferece apenas transmissão em formato de fluxo bruto (.ts) sem playlist HLS (.m3u8). Este formato não é suportado diretamente em navegadores web sem conversão.",
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
      isPlayable: true, // Still allow attempting via proxy
      format: ext,
      warning: `O contêiner (.${ext}) pode não ser reproduzível nativamente no navegador. Formato recomendado: MP4.`,
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
 * Avoids any direct browser HTTP calls and Mixed Content blocks.
 */
export async function getMediaStreamUrl(
  credentials: XtreamCredentials,
  options: RequestMediaUrlOptions
): Promise<string> {
  const { type, streamId, containerExtension, allowedOutputFormats } = options;
  const cleanServerUrl = normalizeServerUrl(credentials.serverUrl);

  const formatCheck = validatePlayableFormat(type, { containerExtension, allowedOutputFormats });
  if (!formatCheck.isPlayable && formatCheck.error) {
    throw new Error(formatCheck.error);
  }

  const ext = formatCheck.format;
  const cacheKey = `${cleanServerUrl}:${type}:${streamId}:${ext}`;
  const now = Date.now();

  const cached = mediaTicketCache.get(cacheKey);
  if (cached && now < cached.expiresAt) {
    return cached.streamUrl;
  }

  const response = await fetch("/api/media/ticket", {
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

  if (!response.ok) {
    let message = "Falha ao preparar a reprodução da mídia.";
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

  // Cache ticket for 1 hour
  mediaTicketCache.set(cacheKey, {
    streamUrl,
    expiresAt: now + 3600 * 1000,
  });

  return streamUrl;
}
