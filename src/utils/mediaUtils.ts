import { XtreamCredentials } from "../types";

/**
 * Fallback SVG image data URI used when a cover, logo or backdrop fails to load
 * or is missing, eliminating any need for backend proxy fallback endpoints.
 */
export const FALLBACK_IMAGE_DATA_URI =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" width="100%" height="100%">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#141923"/>
          <stop offset="100%" stop-color="#0b0e14"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <g fill="none" stroke="#334155" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="translate(170, 270)">
        <rect x="0" y="0" width="60" height="48" rx="6" stroke="#475569" stroke-width="3"/>
        <polygon points="24,14 42,24 24,34" fill="#00df81" stroke="#00df81" stroke-width="2"/>
      </g>
      <text x="200" y="360" fill="#64748b" font-family="system-ui, sans-serif" font-size="14" font-weight="500" text-anchor="middle">
        Sem Imagem
      </text>
    </svg>`
  );

/**
 * Normalizes an Xtream server URL:
 * - Fixes single slash protocols (e.g. "http:/example.com" -> "http://example.com")
 * - Prepends http:// if protocol is missing
 * - Preserves explicit ports (e.g. "example.com:8080")
 * - Preserves user-supplied base paths (e.g. "http://example.com:8080/iptv")
 * - Strips trailing slashes
 * - Returns canonical "http(s)://host(:port)(/basePath)"
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
    const basePath = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host}${basePath}`;
  } catch {
    return trimmed;
  }
}

const COMMON_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "ico",
  "bmp",
  "tiff",
  "avif",
]);

const KNOWN_HTTPS_CDNS = [
  "tmdb.org",
  "themoviedb.org",
  "media-amazon.com",
  "imdb.com",
  "metahub.space",
  "thetvdb.com",
  "fanart.tv",
  "cloudinary.com",
  "imgur.com",
];

/**
 * Checks whether a string represents a schemeless domain with path
 * (e.g. "image.tmdb.org/t/p/w500/..." or "m.media-amazon.com/images/...")
 * as opposed to a relative filename/path (e.g. "logo.png", "covers/123.jpg", "./img.png").
 */
function isSchemelessDomain(str: string): boolean {
  // If it starts with a slash, dot-slash, or has no dot, it is a local/relative path
  if (
    str.startsWith("/") ||
    str.startsWith("./") ||
    str.startsWith("../") ||
    !str.includes(".")
  ) {
    return false;
  }

  // Extract host part before first slash or query string
  const firstSlash = str.indexOf("/");
  const firstQuestion = str.indexOf("?");
  let endOfHost = str.length;
  if (firstSlash !== -1) endOfHost = firstSlash;
  if (firstQuestion !== -1 && firstQuestion < endOfHost) endOfHost = firstQuestion;

  const hostPart = str.slice(0, endOfHost).trim();
  const hostWithoutPort = hostPart.split(":")[0].toLowerCase();

  // If hostWithoutPort ends with a known image extension (e.g. "logo.png", "ch1.jpg"),
  // it is definitely a relative file name, NOT a domain!
  const lastDot = hostWithoutPort.lastIndexOf(".");
  if (lastDot !== -1) {
    const ext = hostWithoutPort.slice(lastDot + 1);
    if (COMMON_IMAGE_EXTENSIONS.has(ext)) {
      return false;
    }
  }

  // Must follow domain naming structure: [sub.]domain.tld where tld has >= 2 alphabetic chars
  const hostRegex = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}(:\d+)?$/;
  return hostRegex.test(hostPart);
}

/**
 * Extracts inner URL from legacy proxy endpoints (e.g. /api/media/image?url=...&serverUrl=...)
 * ONLY when the pathname is specifically '/api/media/image'.
 * Never extracts from generic provider URLs like 'http://logos.test/image.php?url=...'.
 */
export function extractLegacyProxyUrl(urlStr: string): { innerUrl: string; legacyServerUrl?: string } | null {
  try {
    let parsed: URL | null = null;
    const isRelative = urlStr.startsWith("/") || urlStr.startsWith("./");
    if (isRelative) {
      parsed = new URL(urlStr, "http://localhost");
    } else if (/^https?:\/\//i.test(urlStr)) {
      parsed = new URL(urlStr);
    }
    if (!parsed) return null;

    // Strict validation: legacy proxy ONLY when the route is /api/media/image on local origin
    const isLocalAppOrigin =
      isRelative ||
      (typeof window !== "undefined" && window.location && parsed.origin === window.location.origin) ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1";

    if (isLocalAppOrigin && parsed.pathname === "/api/media/image") {
      const inner = parsed.searchParams.get("url");
      if (inner) {
        const legacyServer = parsed.searchParams.get("serverUrl") || undefined;
        return {
          innerUrl: decodeURIComponent(inner).trim(),
          legacyServerUrl: legacyServer ? decodeURIComponent(legacyServer).trim() : undefined,
        };
      }
    }
  } catch {}
  return null;
}

/**
 * Resolves direct image URLs for channel logos, covers, backdrops, and avatars.
 * Directly targets the origin without server proxying:
 * 1. Recognizes legacy proxy links ONLY when pointing to /api/media/image
 * 2. Preserves valid absolute HTTP/HTTPS URLs literally (including query strings, signatures, casing, ports)
 * 3. Preserves data: and blob: URLs
 * 4. Resolves protocol-relative URLs (//domain/...)
 * 5. Distinguishes schemeless domain URLs from relative filenames
 * 6. Resolves relative paths (including ./, ../, and root /) correctly against serverUrl
 */
export function buildDirectImageUrl(
  rawUrl?: string | null,
  serverUrl?: string | null
): string {
  if (!rawUrl || typeof rawUrl !== "string") {
    return FALLBACK_IMAGE_DATA_URI;
  }

  let trimmed = rawUrl.trim();
  if (!trimmed) {
    return FALLBACK_IMAGE_DATA_URI;
  }

  let effectiveBase = serverUrl ? serverUrl.trim() : "";

  // 1. Check if this is a legacy proxy link specifically targeting /api/media/image
  const legacyMatch = extractLegacyProxyUrl(trimmed);
  if (legacyMatch) {
    trimmed = legacyMatch.innerUrl;
    if (legacyMatch.legacyServerUrl && !effectiveBase) {
      effectiveBase = legacyMatch.legacyServerUrl;
    }
  }

  // 2. Preserve data and blob URIs directly
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
    return trimmed;
  }

  // 3. Preserve valid absolute HTTP/HTTPS URLs as-is (CRITICAL: preserve queries, signatures, ports)
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Resolve base server URL (explicit param preferred, fallback to localStorage)
  if (!effectiveBase && typeof window !== "undefined" && window.localStorage) {
    try {
      const saved = window.localStorage.getItem("northcode_tv_credentials");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.serverUrl) {
          effectiveBase = parsed.serverUrl.trim();
        }
      }
    } catch {}
  }

  // 4. Protocol-relative URL: //domain.com/path
  if (trimmed.startsWith("//")) {
    const isKnownHttps = KNOWN_HTTPS_CDNS.some((cdn) => trimmed.includes(cdn));
    const scheme = isKnownHttps
      ? "https:"
      : effectiveBase && effectiveBase.startsWith("https://")
      ? "https:"
      : typeof window !== "undefined" && window.location.protocol.startsWith("http")
      ? window.location.protocol
      : "http:";
    return `${scheme}${trimmed}`;
  }

  // 5. Schemeless domain URL (e.g. image.tmdb.org/..., m.media-amazon.com/...)
  if (isSchemelessDomain(trimmed)) {
    const isKnownHttps = KNOWN_HTTPS_CDNS.some((cdn) => trimmed.includes(cdn));
    const scheme = isKnownHttps
      ? "https://"
      : effectiveBase?.startsWith("https://")
      ? "https://"
      : typeof window !== "undefined" && window.location.protocol === "https:"
      ? "https://"
      : "http://";
    return `${scheme}${trimmed}`;
  }

  // 6. Relative path (e.g. "logo.png", "covers/123.jpg", "/images/logo.png", "./logo.png", "../logo.png")
  if (effectiveBase) {
    try {
      const cleanBase = normalizeServerUrl(effectiveBase);
      // Ensure cleanBase ends with '/' for directory-relative URL resolution
      const baseWithSlash = cleanBase.endsWith("/") ? cleanBase : `${cleanBase}/`;
      const resolved = new URL(trimmed, baseWithSlash);
      return resolved.href;
    } catch {
      // Fallback manual resolution if URL constructor fails
      const cleanBase = normalizeServerUrl(effectiveBase);
      const relativePart = trimmed.replace(/^\/+/, "");
      return `${cleanBase}/${relativePart}`;
    }
  }

  return FALLBACK_IMAGE_DATA_URI;
}

// Backwards-compatible alias
export const getProxiedImageUrl = buildDirectImageUrl;

/**
 * Diagnostic record comparing raw API image string with legacy browser resolution and normalized URL.
 */
export interface ImageUrlDiagnosis {
  rawUrl: string | null | undefined;
  serverUrl: string | null | undefined;
  legacyBrowserResolution: string;
  resolvedUrl: string;
  isIdenticalToLegacy: boolean;
  wasModifiedByNormalizer: boolean;
  isAbsolute: boolean;
  isLegacyProxy: boolean;
  diffCategory:
    | 'identical'
    | 'relative_resolved_to_provider'
    | 'legacy_proxy_extracted'
    | 'modified_by_normalizer'
    | 'fallback_empty';
  notes: string;
}

/**
 * Compares raw API image URL against legacy browser resolution (<img src={rawUrl}>)
 * and the URL generated by buildDirectImageUrl.
 */
export function diagnoseImageUrl(
  rawUrl?: string | null,
  serverUrl?: string | null
): ImageUrlDiagnosis {
  const trimmed = (rawUrl || "").trim();
  const resolved = buildDirectImageUrl(rawUrl, serverUrl);

  // Compute what standard legacy <img src={rawUrl}> would have resolved to in the browser
  let legacyResolution = trimmed;
  if (trimmed && !trimmed.startsWith("data:") && !trimmed.startsWith("blob:")) {
    if (trimmed.startsWith("//")) {
      const proto = typeof window !== "undefined" ? window.location.protocol : "http:";
      legacyResolution = `${proto}${trimmed}`;
    } else if (!/^https?:\/\//i.test(trimmed)) {
      if (typeof window !== "undefined" && window.location.origin) {
        try {
          legacyResolution = new URL(trimmed, window.location.href).href;
        } catch {
          legacyResolution = `${window.location.origin}/${trimmed.replace(/^\/+/, "")}`;
        }
      }
    }
  }

  const isAbs = /^https?:\/\//i.test(trimmed);
  const legacyProxy = Boolean(extractLegacyProxyUrl(trimmed));
  const isIdentical = legacyResolution === resolved;
  const wasModified = isAbs && resolved !== trimmed;

  let diffCategory: ImageUrlDiagnosis['diffCategory'] = 'identical';
  let notes = "";

  if (!trimmed) {
    diffCategory = 'fallback_empty';
    notes = "Fonte vazia ou nula; imagem substituta (SVG) aplicada.";
  } else if (legacyProxy) {
    diffCategory = 'legacy_proxy_extracted';
    notes = "Link herdado do antigo proxy (/api/media/image) extraído com sucesso para conexão direta.";
  } else if (isAbs) {
    if (wasModified) {
      diffCategory = 'modified_by_normalizer';
      notes = "ALERTA: URL absoluta foi modificada pelo normalizador!";
    } else {
      diffCategory = 'identical';
      notes = "URL absoluta intacta, rigorosamente idêntica ao commit de referência. Se falhar, verifique status HTTP na aba Rede (404/403/DNS/Mixed Content).";
    }
  } else {
    diffCategory = 'relative_resolved_to_provider';
    notes = `Caminho relativo resolvido diretamente contra o servidor IPTV (${resolved}) em vez de falhar no host local.`;
  }

  return {
    rawUrl,
    serverUrl,
    legacyBrowserResolution: legacyResolution,
    resolvedUrl: resolved,
    isIdenticalToLegacy: isIdentical,
    wasModifiedByNormalizer: wasModified,
    isAbsolute: isAbs,
    isLegacyProxy: legacyProxy,
    diffCategory,
    notes,
  };
}

export function isDebugImagesEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    Boolean((window as any).__NC_DEBUG_IMAGES__) ||
    window.localStorage?.getItem("nc_debug_images") === "true"
  );
}

export function setDebugImagesEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  (window as any).__NC_DEBUG_IMAGES__ = enabled;
  if (enabled) {
    window.localStorage?.setItem("nc_debug_images", "true");
    console.log("[NC Debug Images] Diagnóstico de imagens ATIVADO.");
  } else {
    window.localStorage?.removeItem("nc_debug_images");
    console.log("[NC Debug Images] Diagnóstico de imagens DESATIVADO.");
  }
}

if (typeof window !== "undefined") {
  (window as any).ncDebugImages = setDebugImagesEnabled;
  (window as any).ncTestImage = (url: string, sUrl?: string) => {
    const diag = diagnoseImageUrl(url, sUrl);
    console.table(diag);
    return diag;
  };
}

export interface BuildDirectMediaUrlOptions {
  type: "live" | "movie" | "series";
  streamId: string | number;
  containerExtension?: string;
  allowedOutputFormats?: string[];
  directSource?: string;
}

/**
 * Builds DIRECT media stream URLs from browser to the IPTV Xtream provider.
 * Follows standard Xtream Codes routing conventions:
 * - Live:   /live/{username}/{password}/{stream_id}.{format}
 * - Movies: /movie/{username}/{password}/{stream_id}.{container_extension}
 * - Series: /series/{username}/{password}/{episode_id}.{container_extension}
 *
 * Encodes individual path segments with encodeURIComponent while preserving slashes.
 * Preserves the provider's scheme, host, and explicit port.
 */
export function buildDirectMediaUrl(
  credentials: Pick<XtreamCredentials, "serverUrl" | "username" | "password">,
  options: BuildDirectMediaUrlOptions
): string {
  const { type, streamId, containerExtension, allowedOutputFormats, directSource } = options;

  // If a valid direct_source is provided and is a full URL, consider it
  if (directSource && typeof directSource === "string") {
    const trimmedSource = directSource.trim();
    if (/^https?:\/\//i.test(trimmedSource)) {
      return trimmedSource;
    }
  }

  const cleanBase = normalizeServerUrl(credentials.serverUrl);
  const user = encodeURIComponent(credentials.username);
  const pass = encodeURIComponent(credentials.password);
  const id = encodeURIComponent(String(streamId).trim());

  if (type === "live") {
    let format = "m3u8";

    if (containerExtension) {
      const cleaned = containerExtension.trim().replace(/^\./, "").toLowerCase();
      if (cleaned) format = cleaned;
    } else if (allowedOutputFormats && Array.isArray(allowedOutputFormats) && allowedOutputFormats.length > 0) {
      const lowerFormats = allowedOutputFormats.map((f) => String(f).toLowerCase());
      if (lowerFormats.includes("m3u8")) {
        format = "m3u8";
      } else if (lowerFormats.includes("ts")) {
        format = "ts";
      }
    }

    return `${cleanBase}/live/${user}/${pass}/${id}.${format}`;
  }

  if (type === "movie") {
    const rawExt = containerExtension || "mp4";
    const ext = encodeURIComponent(rawExt.trim().replace(/^\./, "").toLowerCase() || "mp4");
    return `${cleanBase}/movie/${user}/${pass}/${id}.${ext}`;
  }

  if (type === "series") {
    const rawExt = containerExtension || "mp4";
    const ext = encodeURIComponent(rawExt.trim().replace(/^\./, "").toLowerCase() || "mp4");
    return `${cleanBase}/series/${user}/${pass}/${id}.${ext}`;
  }

  return `${cleanBase}/live/${user}/${pass}/${id}.m3u8`;
}

// Backwards-compatible alias returning direct URL synchronously or as resolved promise
export async function getMediaStreamUrl(
  credentials: XtreamCredentials,
  options: {
    type: "live" | "movie" | "series";
    streamId: string | number;
    containerExtension?: string;
    allowedOutputFormats?: string[];
  }
): Promise<string> {
  return buildDirectMediaUrl(credentials, {
    type: options.type,
    streamId: options.streamId,
    containerExtension: options.containerExtension,
    allowedOutputFormats: options.allowedOutputFormats,
  });
}
