import { XtreamCredentials } from "../types";

/**
 * Normalizes image source metadata that may arrive as a string, an array of strings,
 * null, or undefined from Xtream Codes API endpoints.
 * Extracts a valid non-empty trimmed string, preventing string indexing bugs
 * like `backdrop_path[0]` grabbing 'h' from 'http...'.
 */
export function normalizeImageSource(source: unknown): string | null {
  if (!source) return null;
  if (Array.isArray(source)) {
    for (const item of source) {
      if (typeof item === "string" && item.trim()) {
        return item.trim();
      }
    }
    return null;
  }
  if (typeof source === "string") {
    const trimmed = source.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

/**
 * Normalizes text metadata that may arrive from Xtream providers as a string or array of strings
 * (e.g. cast, director, genre) without fabricating unavailable values.
 */
export function normalizeMetadataText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (trimmed) parts.push(trimmed);
      } else if (typeof item === "number" && Number.isFinite(item)) {
        parts.push(String(item));
      }
    }
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
}

const DISALLOWED_URL_SCHEMES = new Set([
  "javascript",
  "vbscript",
  "data",
  "blob",
  "file",
  "mailto",
  "tel",
  "about",
  "ftp",
  "ftps",
  "rtmp",
  "rtmps",
  "rtsp",
  "ws",
  "wss",
  "udp",
  "rtp",
  "magnet",
  "chrome",
  "edge",
]);

function repairCommonHttpProtocolTypos(input: string): string {
  let fixed = input;
  // Backslashes after http:/https: (e.g. "http:\\example.com" -> "http://example.com")
  fixed = fixed.replace(/^(https?):\\+/i, "$1://");
  // Semicolon typo in protocol (e.g. "http;//example.com" -> "http://example.com")
  fixed = fixed.replace(/^(https?);\/+/i, "$1://");
  // Missing colon after protocol (e.g. "http//example.com" -> "http://example.com")
  fixed = fixed.replace(/^(https?)\/\//i, "$1://");
  // Single or excessive slashes after http:/https: (e.g. "http:/example.com", "https:///example.com")
  fixed = fixed.replace(/^(https?):\/+/i, "$1://");
  // Simple letter typos only when explicitly followed by :/ or ://
  fixed = fixed.replace(/^(?:htp|htpp|ttp|hhtp|htttp):\/+/i, "http://");
  fixed = fixed.replace(/^(?:htps|htpps|ttps|hhtps|htttps):\/+/i, "https://");
  return fixed;
}

function isValidServerHostname(hostname: string): boolean {
  if (!hostname) return false;
  const lower = hostname.toLowerCase();

  // IPv6 literal (e.g. [::1], [2001:db8::1])
  if (lower.startsWith("[") && lower.endsWith("]")) {
    const inner = lower.slice(1, -1);
    return inner.length >= 2 && /^[0-9a-f:]+$/i.test(inner) && inner.includes(":");
  }

  if (lower === "localhost") {
    return true;
  }

  // Must contain at least one dot (domain or IPv4) and not start/end with dot or contain empty labels
  if (!lower.includes(".") || lower.startsWith(".") || lower.endsWith(".") || lower.includes("..")) {
    return false;
  }

  // IPv4 validation
  if (/^\d+(?:\.\d+)+$/.test(lower)) {
    const octets = lower.split(".");
    if (octets.length !== 4) return false;
    return octets.every((octet) => {
      if (!/^\d{1,3}$/.test(octet)) return false;
      const num = Number(octet);
      return Number.isInteger(num) && num >= 0 && num <= 255;
    });
  }

  // Domain hostname labels (supports standard DNS and punycode labels)
  const labels = lower.split(".");
  if (labels.length < 2) return false;
  return labels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  );
}

function prepareHttpCandidateUrl(rawInput: string): URL | null {
  if (!rawInput || typeof rawInput !== "string") return null;
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // Reject internal whitespace or ASCII control chars
  if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) {
    return null;
  }

  const repaired = repairCommonHttpProtocolTypos(trimmed);

  // Reject relative paths or protocol-relative strings as server base URLs
  if (repaired.startsWith("/")) {
    return null;
  }

  let candidate = repaired;
  const hasHttpScheme = /^https?:\/\//i.test(repaired);

  if (!hasHttpScheme) {
    // Explicit non-HTTP scheme with :// (e.g. ftp://, rtmp://, ws://)
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(repaired)) {
      return null;
    }

    // Check scheme:rest vs host:port
    const colonMatch = repaired.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/);
    if (colonMatch) {
      const prefix = colonMatch[1].toLowerCase();
      const rest = colonMatch[2];
      const looksLikePort = /^\d+(?:[/?#]|$)/.test(rest);
      if (DISALLOWED_URL_SCHEMES.has(prefix) || !looksLikePort) {
        return null;
      }
    }

    candidate = `http://${repaired}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  // Reject userinfo credentials embedded in authority (e.g. email addresses like user@example.com)
  if (parsed.username || parsed.password) {
    return null;
  }

  // Reject explicit port 0
  if (parsed.port === "0") {
    return null;
  }

  if (!isValidServerHostname(parsed.hostname)) {
    return null;
  }

  return parsed;
}

/**
 * Normalizes an Xtream server URL:
 * - Supports HTTP and HTTPS
 * - Defaults schemeless domains/IPs to HTTP
 * - Fixes common protocol typos (e.g. "http:/example.com", "htpp://example.com")
 * - Preserves custom ports and provider base paths
 * - Strips trailing slashes and trailing Xtream API script names (/player_api.php, /get.php)
 * - Rejects invalid URLs and incompatible protocols (returning "") instead of prefixing http:// blindly
 * - Returns canonical "http(s)://host(:port)(/basePath)"
 */
export function normalizeServerUrl(rawUrl: string): string {
  const parsed = prepareHttpCandidateUrl(rawUrl);
  if (!parsed) return "";

  const basePath = parsed.pathname
    .replace(/\/(?:player_api|get)\.php\/?$/i, "")
    .replace(/\/+$/, "");

  return `${parsed.protocol}//${parsed.host}${basePath}`;
}

export interface ExtractedXtreamLinkCredentials {
  serverUrl: string;
  username: string;
  password: string;
  endpoint: "get.php" | "player_api.php";
}

/**
 * Extracts Xtream server base URL, username, and exact password from a pasted
 * Xtream `get.php` or `player_api.php` link (with or without explicit protocol).
 * Never alters password casing/whitespace and rejects non-HTTP(S) or non-Xtream URLs.
 */
export function extractXtreamCredentialsFromUrl(
  rawInput: string
): ExtractedXtreamLinkCredentials | null {
  const parsed = prepareHttpCandidateUrl(rawInput);
  if (!parsed) return null;

  const endpointMatch = parsed.pathname.match(/\/(get\.php|player_api\.php)\/?$/i);
  if (!endpointMatch) return null;

  const rawUser = parsed.searchParams.get("username");
  const rawPass = parsed.searchParams.get("password");
  if (!rawUser || !rawUser.trim() || rawPass === null || rawPass.length === 0) {
    return null;
  }

  const cleanBasePath = parsed.pathname
    .replace(/\/(?:get|player_api)\.php\/?$/i, "")
    .replace(/\/+$/, "");

  return {
    serverUrl: `${parsed.protocol}//${parsed.host}${cleanBasePath}`,
    username: rawUser.trim(),
    password: rawPass,
    endpoint: endpointMatch[1].toLowerCase() as "get.php" | "player_api.php",
  };
}

/**
 * Normalizes provider `allowed_output_formats` metadata without dropping legitimate formats
 * or fabricating permissions when the field is absent/null.
 * - Returns `undefined` when the provider did not supply format information.
 * - Returns `[]` when the provider explicitly supplied an empty array.
 * - Returns deduplicated lowercase format tokens preserving original provider order otherwise.
 */
export function normalizeAllowedOutputFormats(
  rawFormats: unknown
): string[] | undefined {
  if (rawFormats === null || rawFormats === undefined) {
    return undefined;
  }

  if (Array.isArray(rawFormats) && rawFormats.length === 0) {
    return [];
  }

  let candidates: unknown[];
  if (Array.isArray(rawFormats)) {
    candidates = rawFormats;
  } else if (typeof rawFormats === "string") {
    const trimmed = rawFormats.trim();
    if (!trimmed) return undefined;
    candidates = trimmed.split(/[,;\s]+/);
  } else if (typeof rawFormats === "object") {
    candidates = Object.values(rawFormats as Record<string, unknown>);
  } else {
    return undefined;
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of candidates) {
    if (typeof item !== "string") continue;
    const cleaned = item.trim().replace(/^\.+/, "").toLowerCase();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    normalized.push(cleaned);
  }

  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Validates and preserves a direct HTTP/HTTPS playback source (`direct_source`) literally,
 * keeping query parameters, signatures, casing, encoding, and extensionless paths intact.
 * Returns null if missing, non-HTTP(S), or structurally invalid.
 */
export function normalizeDirectMediaSource(rawSource: unknown): string | null {
  if (typeof rawSource !== "string") return null;
  const trimmed = rawSource.trim();
  if (!trimmed) return null;
  if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }
    // Preserve the exact literal URL string so signed tokens/casing/encoding are never altered
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Sanitizes a container extension without enforcing an artificial format whitelist.
 */
export function normalizeContainerExtension(rawExt: unknown): string | null {
  if (typeof rawExt !== "string") return null;
  const cleaned = rawExt.trim().replace(/^\.+/, "").toLowerCase();
  if (!cleaned) return null;
  if (!/^[a-z0-9][a-z0-9._-]{0,15}$/.test(cleaned)) {
    return null;
  }
  return cleaned;
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

/**
 * Checks whether a string represents a schemeless domain with path
 * (e.g. "image.tmdb.org/t/p/w500/..." or "images.provider.tv/ch1.png")
 * as opposed to a relative filename/path (e.g. "logo.png", "covers/123.jpg", "./img.png").
 */
export function isSchemelessDomain(str: string): boolean {
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

  // If host ends with a known image extension (e.g. "logo.png", "ch1.jpg"),
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
 * ONLY when the pathname is specifically '/api/media/image' on the local app origin.
 * Never extracts from generic provider URLs like 'http://logos.test/image.php?url=...'.
 * Note: URLSearchParams.get already decodes once, avoiding secondary decodeURIComponent
 * that would alter signed parameters.
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
      if (inner && inner.trim()) {
        const legacyServer = parsed.searchParams.get("serverUrl");
        return {
          innerUrl: inner.trim(),
          legacyServerUrl: legacyServer ? legacyServer.trim() : undefined,
        };
      }
    }
  } catch {}
  return null;
}

/**
 * Standardized URL resolution for channel logos, movie posters, series covers, and backdrops.
 * Separated from loading state:
 * 1. Preserves valid absolute HTTP/HTTPS URLs literally (including query strings, signatures, casing, ports).
 * 2. Preserves data: and blob: URLs.
 * 3. Resolves protocol-relative URLs (//domain/...).
 * 4. Resolves schemeless domain URLs with appropriate scheme.
 * 5. Resolves relative paths against the provider serverUrl base.
 * 6. Returns null when source is empty, invalid, or unresolvable (never returns a fallback SVG).
 */
export function buildDirectImageUrl(
  rawUrl?: unknown,
  serverUrl?: string | null
): string | null {
  const normalized = normalizeImageSource(rawUrl);
  if (!normalized) {
    return null;
  }

  let trimmed = normalized;
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

  // 4. Protocol-relative URL: //domain.com/path
  if (trimmed.startsWith("//")) {
    const scheme = effectiveBase?.startsWith("https:")
      ? "https:"
      : typeof window !== "undefined" && window.location.protocol === "https:"
      ? "https:"
      : "http:";
    return `${scheme}${trimmed}`;
  }

  // 5. Schemeless domain URL (e.g. image.tmdb.org/...)
  if (isSchemelessDomain(trimmed)) {
    const scheme = effectiveBase?.startsWith("https://")
      ? "https://"
      : typeof window !== "undefined" && window.location.protocol === "https:"
      ? "https://"
      : "http://";
    return `${scheme}${trimmed}`;
  }

  // 6. Relative path (e.g. "logo.png", "/logos/1.png", "./ch.png", "../ch.png")
  if (effectiveBase) {
    const cleanBase = normalizeServerUrl(effectiveBase);
    if (!cleanBase) return null;
    try {
      const baseWithSlash = cleanBase.endsWith("/") ? cleanBase : `${cleanBase}/`;
      const resolved = new URL(trimmed, baseWithSlash);
      return resolved.href;
    } catch {
      const relativePart = trimmed.replace(/^\/+/, "");
      return `${cleanBase}/${relativePart}`;
    }
  }

  return null;
}

export interface BuildDirectMediaUrlOptions {
  type: "live" | "movie" | "series";
  streamId: string | number;
  containerExtension?: string | null;
  allowedOutputFormats?: string[] | string | Record<string, unknown> | null;
  directSource?: string | null;
}

/**
 * Builds DIRECT media stream URLs from browser to the IPTV Xtream provider.
 * - Uses valid HTTP/HTTPS `directSource` literally without adding Xtream credentials.
 * - Otherwise follows standard Xtream Codes routing conventions:
 *   - Live:   /live/{username}/{password}/{stream_id}.{format}
 *   - Movies: /movie/{username}/{password}/{stream_id}.{container_extension}
 *   - Series: /series/{username}/{password}/{episode_id}.{container_extension}
 */
export function buildDirectMediaUrl(
  credentials: Pick<XtreamCredentials, "serverUrl" | "username" | "password">,
  options: BuildDirectMediaUrlOptions
): string {
  const { type, streamId, containerExtension, allowedOutputFormats, directSource } = options;

  const validDirectSource = normalizeDirectMediaSource(directSource);
  if (validDirectSource) {
    return validDirectSource;
  }

  const cleanBase = normalizeServerUrl(credentials.serverUrl);
  if (!cleanBase) {
    throw new Error("URL do servidor Xtream inválida para construir o endereço de reprodução.");
  }

  const user = encodeURIComponent(credentials.username);
  const pass = encodeURIComponent(credentials.password);
  const id = encodeURIComponent(String(streamId).trim());

  if (type === "live") {
    let format = "m3u8";

    const cleanedExt = normalizeContainerExtension(containerExtension);
    if (cleanedExt) {
      format = cleanedExt;
    } else {
      const normalizedFormats = normalizeAllowedOutputFormats(allowedOutputFormats);
      if (normalizedFormats && normalizedFormats.length > 0) {
        if (normalizedFormats.includes("m3u8")) {
          format = "m3u8";
        } else if (normalizedFormats.includes("ts")) {
          format = "ts";
        }
      }
    }

    return `${cleanBase}/live/${user}/${pass}/${id}.${encodeURIComponent(format)}`;
  }

  if (type === "movie") {
    const ext = normalizeContainerExtension(containerExtension) || "mp4";
    return `${cleanBase}/movie/${user}/${pass}/${id}.${encodeURIComponent(ext)}`;
  }

  if (type === "series") {
    const ext = normalizeContainerExtension(containerExtension) || "mp4";
    return `${cleanBase}/series/${user}/${pass}/${id}.${encodeURIComponent(ext)}`;
  }

  return `${cleanBase}/live/${user}/${pass}/${id}.m3u8`;
}

