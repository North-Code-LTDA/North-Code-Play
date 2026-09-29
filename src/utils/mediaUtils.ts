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

/**
 * Builds direct image URLs for covers, channel logos, backdrops, and avatars.
 * Directly requests the origin without any server proxy:
 * - Absolute URLs (http:// or https://) returned as-is
 * - Protocol-relative URLs (starting with //) resolved with provider or page scheme
 * - Schemeless domain URLs prepended with scheme
 * - Path-relative or root-relative URLs resolved against serverUrl
 * - Invalid/empty URLs return the inline SVG fallback
 */
export function buildDirectImageUrl(rawUrl?: string | null, serverUrl?: string | null): string {
  if (!rawUrl || typeof rawUrl !== "string") {
    return FALLBACK_IMAGE_DATA_URI;
  }

  let trimmed = rawUrl.trim();
  if (!trimmed) {
    return FALLBACK_IMAGE_DATA_URI;
  }

  // Preserve data URLs and blob URLs
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
    return trimmed;
  }

  // Auto-detect serverUrl from localStorage if not explicitly passed
  let effectiveServerUrl = serverUrl;
  if (!effectiveServerUrl && typeof window !== "undefined" && window.localStorage) {
    try {
      const saved = window.localStorage.getItem("northcode_tv_credentials");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.serverUrl) {
          effectiveServerUrl = parsed.serverUrl;
        }
      }
    } catch {}
  }

  // 1. Protocol-relative URL: //domain.com/path
  if (trimmed.startsWith("//")) {
    const protocol =
      effectiveServerUrl && effectiveServerUrl.startsWith("https://")
        ? "https:"
        : effectiveServerUrl && effectiveServerUrl.startsWith("http://")
        ? "http:"
        : typeof window !== "undefined" && window.location.protocol.startsWith("http")
        ? window.location.protocol
        : "http:";
    return `${protocol}${trimmed}`;
  }

  // 2. Direct absolute URLs
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  // 3. Schemeless domain URL (e.g. images.tmdb.org/..., m.media-amazon.com/...)
  if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(:\d+)?(\/.*)?$/.test(trimmed)) {
    const scheme =
      effectiveServerUrl && effectiveServerUrl.startsWith("http://") ? "http://" : "https://";
    return `${scheme}${trimmed}`;
  }

  // 4. Relative path resolved against serverUrl
  if (effectiveServerUrl) {
    try {
      const cleanBase = normalizeServerUrl(effectiveServerUrl);
      const relativePart = trimmed.replace(/^\/+/, "");
      return `${cleanBase}/${relativePart}`;
    } catch {
      // ignore
    }
  }

  return FALLBACK_IMAGE_DATA_URI;
}

// Alias for backwards compatibility across existing components
export const getProxiedImageUrl = buildDirectImageUrl;

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
