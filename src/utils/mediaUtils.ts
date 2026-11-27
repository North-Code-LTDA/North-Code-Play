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

function isValidServerHostname(
  hostname: string,
  allowSingleLabelInternal: boolean = false
): boolean {
  if (!hostname) return false;
  const lower = hostname.toLowerCase();

  // IPv6 literal (e.g. [::1], [2001:db8::1])
  if (lower.startsWith("[") && lower.endsWith("]")) {
    const inner = lower.slice(1, -1);
    return inner.length >= 2 && /^[0-9a-f:]+$/i.test(inner) && inner.includes(":");
  }

  // Reject empty, leading dot, or consecutive dots (e.g. ".", "..", ".example.com", "a..b")
  if (lower.startsWith(".") || lower.includes("..")) {
    return false;
  }

  // IPv4 validation (strict 4 octets, no trailing dot)
  if (/^\d+(?:\.\d+)+$/.test(lower)) {
    const octets = lower.split(".");
    if (octets.length !== 4) return false;
    return octets.every((octet) => {
      if (!/^\d{1,3}$/.test(octet)) return false;
      const num = Number(octet);
      return Number.isInteger(num) && num >= 0 && num <= 255;
    });
  }

  // Allow a single trailing dot for valid FQDNs (e.g. "example.com.", "localhost.")
  const normalizedHost = lower.endsWith(".") ? lower.slice(0, -1) : lower;
  if (!normalizedHost || normalizedHost.length > 253) {
    return false;
  }

  if (normalizedHost === "localhost") {
    return true;
  }

  const labels = normalizedHost.split(".");
  const allValidLabels = labels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  );
  if (!allValidLabels) {
    return false;
  }

  // Multi-label domain name (e.g. example.com, panel.internal.local, example.com.)
  if (labels.length >= 2) {
    // Reject dotted numeric strings with trailing dot (e.g. "1.2.3.4.")
    if (labels.every((label) => /^\d+$/.test(label))) {
      return false;
    }
    return true;
  }

  // Single-label internal network hostname (e.g. http://iptv:8080, https://my-server, iptv:8080)
  // Accepted only when explicit HTTP/HTTPS scheme or explicit port is provided, and must contain a letter
  if (allowSingleLabelInternal && /[a-z]/.test(labels[0])) {
    return true;
  }

  return false;
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
  let hasExplicitPort = false;

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
      hasExplicitPort = true;
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

  // Reject purely numeric single-label hosts before WHATWG URL IPv4 coercion (e.g. "http://12345")
  const authorityPart = candidate.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
  const rawHostOnly = authorityPart.startsWith("[")
    ? authorityPart
    : authorityPart.split(":")[0];
  if (/^\d+$/.test(rawHostOnly)) {
    return null;
  }

  const allowSingleLabelInternal =
    hasHttpScheme || hasExplicitPort || Boolean(parsed.port);
  if (!isValidServerHostname(parsed.hostname, allowSingleLabelInternal)) {
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

const FORBIDDEN_SEASON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Validates a media identifier (stream_id, series_id, episode id), preserving original
 * string or number precision without coercion. Rejects null, undefined, empty/whitespace
 * strings, NaN, and non-finite numbers.
 */
export function getValidMediaId(rawId: unknown): string | number | null {
  if (typeof rawId === "number") {
    return Number.isFinite(rawId) ? rawId : null;
  }
  if (typeof rawId === "string") {
    const trimmed = rawId.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

/**
 * Resolves a valid episode identifier consistently across `id` and `stream_id`.
 * Never fabricates an identifier or returns empty/invalid values.
 */
export function getEpisodeId(episode: unknown): string | number | null {
  if (!episode || typeof episode !== "object") return null;
  const ep = episode as Record<string, unknown>;
  return getValidMediaId(ep.id) ?? getValidMediaId(ep.stream_id);
}

/**
 * Sorts season keys numerically when possible, falling back to natural locale order.
 */
export function sortSeasonKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const aTrim = a.trim();
    const bTrim = b.trim();
    const aIsNum = /^\d+$/.test(aTrim);
    const bIsNum = /^\d+$/.test(bTrim);
    if (aIsNum && bIsNum) {
      return parseInt(aTrim, 10) - parseInt(bTrim, 10);
    }
    if (aIsNum) return -1;
    if (bIsNum) return 1;
    return aTrim.localeCompare(bTrim, undefined, { numeric: true, sensitivity: "base" });
  });
}

export interface NormalizedSeriesEpisodes {
  seasons: Record<string, any[]>;
  sortedSeasonKeys: string[];
  unseasonedEpisodes: any[];
}

function normalizeSeasonKeyToken(rawSeason: unknown): string | null {
  if (typeof rawSeason === "number") {
    return Number.isFinite(rawSeason) ? String(rawSeason) : null;
  }
  if (typeof rawSeason === "string") {
    const trimmed = rawSeason.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    if (lower === "null" || lower === "undefined") return null;
    if (FORBIDDEN_SEASON_KEYS.has(lower)) return null;
    return trimmed;
  }
  return null;
}

/**
 * Shared lightweight normalizer for Xtream `episodes` structures across all series consumers:
 * - Season maps of episode arrays (`Record<string, Episode[]>`)
 * - Season maps of episode objects (`Record<string, Record<string, Episode>>`)
 * - Flat episode arrays (`Episode[]`)
 *
 * Uses null-prototype storage and blocks special prototype property names.
 * Never fabricates season "1" when a flat episode lacks valid season information;
 * instead exposes those items explicitly in `unseasonedEpisodes`.
 * Preserves original episode object references without cloning.
 */
export function normalizeEpisodesBySeason(
  rawEpisodes: unknown
): NormalizedSeriesEpisodes {
  const seasons: Record<string, any[]> = Object.create(null);
  const unseasonedEpisodes: any[] = [];

  if (!rawEpisodes || typeof rawEpisodes !== "object") {
    return { seasons, sortedSeasonKeys: [], unseasonedEpisodes };
  }

  if (Array.isArray(rawEpisodes)) {
    for (const ep of rawEpisodes) {
      if (!ep || typeof ep !== "object" || Array.isArray(ep)) continue;
      const epObj = ep as Record<string, unknown>;
      const seasonKey =
        normalizeSeasonKeyToken(epObj.season) ??
        normalizeSeasonKeyToken(epObj.season_num) ??
        normalizeSeasonKeyToken(epObj.season_number);

      if (seasonKey !== null) {
        if (!Object.prototype.hasOwnProperty.call(seasons, seasonKey)) {
          seasons[seasonKey] = [];
        }
        seasons[seasonKey].push(ep);
      } else {
        unseasonedEpisodes.push(ep);
      }
    }
    return {
      seasons,
      sortedSeasonKeys: sortSeasonKeys(Object.keys(seasons)),
      unseasonedEpisodes,
    };
  }

  const rawMap = rawEpisodes as Record<string, unknown>;
  for (const rawKey of Object.keys(rawMap)) {
    const seasonKey = normalizeSeasonKeyToken(rawKey);
    if (seasonKey === null) continue;
    const seasonValue = rawMap[rawKey];

    if (Array.isArray(seasonValue)) {
      const validEpisodes = seasonValue.filter(
        (ep) => ep && typeof ep === "object" && !Array.isArray(ep)
      );
      if (!Object.prototype.hasOwnProperty.call(seasons, seasonKey)) {
        seasons[seasonKey] = validEpisodes;
      } else {
        seasons[seasonKey].push(...validEpisodes);
      }
    } else if (seasonValue && typeof seasonValue === "object") {
      const objVal = seasonValue as Record<string, unknown>;
      const validEpisodes: any[] = [];
      for (const epKey of Object.keys(objVal)) {
        if (FORBIDDEN_SEASON_KEYS.has(epKey.toLowerCase())) continue;
        const ep = objVal[epKey];
        if (ep && typeof ep === "object" && !Array.isArray(ep)) {
          validEpisodes.push(ep);
        }
      }
      if (validEpisodes.length > 0) {
        if (!Object.prototype.hasOwnProperty.call(seasons, seasonKey)) {
          seasons[seasonKey] = validEpisodes;
        } else {
          seasons[seasonKey].push(...validEpisodes);
        }
      }
    }
  }

  return {
    seasons,
    sortedSeasonKeys: sortSeasonKeys(Object.keys(seasons)),
    unseasonedEpisodes,
  };
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
 * - Validates streamId and serverUrl explicitly; never constructs URLs with empty/undefined IDs.
 * - For Live TV, respects provider `allowedOutputFormats` order without artificial whitelists:
 *   - Explicit empty `[]` fails with a controlled error instead of emitting an unapproved format.
 *   - Non-empty list uses explicit `containerExtension` only if included in `allowedOutputFormats`,
 *     otherwise selects `allowedOutputFormats[0]`.
 *   - Absent `allowedOutputFormats` falls back to `containerExtension || "m3u8"`.
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

  const validStreamId = getValidMediaId(streamId);
  if (validStreamId === null) {
    throw new Error(
      "Identificador de mídia inválido ou ausente para construir o endereço de reprodução."
    );
  }

  const user = encodeURIComponent(credentials.username);
  const pass = encodeURIComponent(credentials.password);
  const id = encodeURIComponent(String(validStreamId));

  if (type === "live") {
    const normalizedFormats = normalizeAllowedOutputFormats(allowedOutputFormats);
    const cleanedExt = normalizeContainerExtension(containerExtension);
    let format: string;

    if (normalizedFormats !== undefined) {
      if (normalizedFormats.length === 0) {
        throw new Error(
          "O provedor não informou nenhum formato de saída permitido para este canal ao vivo."
        );
      }
      if (cleanedExt && normalizedFormats.includes(cleanedExt)) {
        format = cleanedExt;
      } else {
        format = normalizedFormats[0];
      }
    } else {
      format = cleanedExt || "m3u8";
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

// ============================================================================
// M01 — Source Identification, Engine Selection, Authorized Fallback & Error Classification
// ============================================================================

export type PlaybackContentType = "live" | "movie" | "episode";
export type PlaybackSourceOrigin = "direct_source" | "conventional_xtream";
export type PlaybackTransportProtocol = "http" | "https" | "blob" | "data" | "unsupported" | "invalid";
export type PlaybackTransportMode = "hls" | "progressive" | "unknown";
export type PlaybackEngineKind = "hls.js" | "native-hls" | "native";
export type PlaybackDetectionSource =
  | "mime_type"
  | "pathname_extension"
  | "query_param"
  | "provider_metadata"
  | "unknown";

export interface PlaybackSourceMetadata {
  /** Explicit content type informed by consumer */
  contentType: PlaybackContentType;
  /** Known URL origin: literal provider direct_source or conventional Xtream URL generated by the app */
  sourceOrigin: PlaybackSourceOrigin;
  /** Media/stream identifier associated with this playback source */
  streamId?: string | number | null;
  /** Original container_extension declared by provider (null when absent; never fabricated) */
  declaredContainerExtension?: string | null;
  /** Container extension actually emitted in a conventional URL (null for direct_source) */
  resolvedContainerExtension?: string | null;
  /** MIME type only when explicitly provided by provider (never fabricated) */
  mimeType?: string | null;
  /**
   * Authorized Live output formats from provider/session:
   * - undefined: provider omitted allowed_output_formats
   * - non-empty array: authorized formats in provider order
   * - empty array: confirmed zero authorized formats
   */
  allowedOutputFormats?: string[];
  /** Preserved literal direct_source URL when sourceOrigin === 'direct_source' */
  directSource?: string | null;
}

export interface PreparePlaybackMediaSourceOptions extends BuildDirectMediaUrlOptions {
  mimeType?: string | null;
}

export interface PreparedPlaybackMediaSource {
  url: string;
  metadata: PlaybackSourceMetadata;
}

/**
 * Extracts an explicit MIME type string from a provider object only when present.
 * Never fabricates MIME types or codec strings.
 */
export function extractExplicitMediaMimeType(raw: unknown): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.includes("/") ? trimmed : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const candidates = [obj.mime_type, obj.mimeType, obj.content_type, obj.contentType];
  for (const cand of candidates) {
    if (typeof cand === "string") {
      const trimmed = cand.trim();
      if (trimmed.includes("/")) return trimmed;
    }
  }
  return null;
}

/**
 * M01.b — Prepares a playback media URL alongside its canonical PlaybackSourceMetadata contract.
 * - Preserves valid HTTP/HTTPS `direct_source` literally with `sourceOrigin: "direct_source"`.
 * - Distinguishes `declaredContainerExtension` (provider-announced) from `resolvedContainerExtension` (URL-emitted).
 * - Preserves tri-state `allowedOutputFormats` (`undefined` | non-empty list | confirmed `[]`).
 */
export function preparePlaybackMediaSource(
  credentials: Pick<XtreamCredentials, "serverUrl" | "username" | "password"> & {
    allowed_output_formats?: XtreamCredentials["allowed_output_formats"];
  },
  options: PreparePlaybackMediaSourceOptions
): PreparedPlaybackMediaSource {
  const contentType: PlaybackContentType =
    options.type === "live" ? "live" : options.type === "series" ? "episode" : "movie";
  const declaredContainerExtension = normalizeContainerExtension(options.containerExtension);
  const mimeType = extractExplicitMediaMimeType(options.mimeType);
  const validStreamId = getValidMediaId(options.streamId);
  const effectiveAllowedFormats =
    options.type === "live"
      ? normalizeAllowedOutputFormats(
          options.allowedOutputFormats !== undefined
            ? options.allowedOutputFormats
            : credentials.allowed_output_formats
        )
      : undefined;

  const validDirectSource = normalizeDirectMediaSource(options.directSource);
  if (validDirectSource) {
    return {
      url: validDirectSource,
      metadata: {
        contentType,
        sourceOrigin: "direct_source",
        streamId: validStreamId,
        declaredContainerExtension,
        resolvedContainerExtension: null,
        mimeType,
        allowedOutputFormats: effectiveAllowedFormats,
        directSource: validDirectSource,
      },
    };
  }

  const url = buildDirectMediaUrl(credentials, {
    ...options,
    allowedOutputFormats:
      options.type === "live" ? effectiveAllowedFormats : options.allowedOutputFormats,
    directSource: undefined,
  });

  let resolvedContainerExtension: string | null = null;
  if (options.type === "live") {
    if (effectiveAllowedFormats !== undefined && effectiveAllowedFormats.length > 0) {
      resolvedContainerExtension =
        declaredContainerExtension && effectiveAllowedFormats.includes(declaredContainerExtension)
          ? declaredContainerExtension
          : effectiveAllowedFormats[0];
    } else {
      resolvedContainerExtension = declaredContainerExtension || "m3u8";
    }
  } else {
    resolvedContainerExtension = declaredContainerExtension || "mp4";
  }

  return {
    url,
    metadata: {
      contentType,
      sourceOrigin: "conventional_xtream",
      streamId: validStreamId,
      declaredContainerExtension,
      resolvedContainerExtension,
      mimeType,
      allowedOutputFormats: effectiveAllowedFormats,
      directSource: null,
    },
  };
}

export type PlaybackErrorCategory =
  | "invalid_url"
  | "unsupported_protocol"
  | "source_unavailable"
  | "network_error"
  | "timeout"
  | "access_restricted"
  | "rate_limited"
  | "invalid_manifest"
  | "incompatible_container_or_codec"
  | "decode_error"
  | "cors_or_mixed_content"
  | "user_aborted";

export interface MediaSourceIdentification {
  url: string;
  isValidUrl: boolean;
  isSupportedProtocol: boolean;
  protocol: PlaybackTransportProtocol;
  rawScheme: string;
  transport: PlaybackTransportMode;
  container: string;
  contentType: PlaybackContentType;
  detectionSource: PlaybackDetectionSource;
  detectedExtension: string | null;
  detectedMimeType: string | null;
  sourceOrigin: PlaybackSourceOrigin | "unknown";
  isDirectSource: boolean;
  isConventionalXtreamLiveUrl: boolean;
}

export interface IdentifyMediaSourceOptions {
  url: string;
  contentType?: PlaybackContentType | null;
  containerExtension?: string | null;
  mimeType?: string | null;
  directSource?: string | null;
  sourceOrigin?: PlaybackSourceOrigin | null;
  sourceMetadata?: PlaybackSourceMetadata | null;
  credentials?: Pick<
    XtreamCredentials,
    "serverUrl" | "username" | "password" | "allowed_output_formats"
  > | null;
}

export interface PlaybackEnvironmentCapabilities {
  hlsJsSupported: boolean;
  nativeHlsSupported: boolean;
  canPlayType?: (mimeType: string) => string;
}

export interface PlaybackEngineSelection {
  primaryEngine: PlaybackEngineKind | null;
  fallbackEngine: PlaybackEngineKind | null;
  reason: string;
}

export interface PlaybackAttemptDescriptor {
  url: string;
  engine: PlaybackEngineKind;
  source: MediaSourceIdentification;
  isFallback: boolean;
  fallbackKind?: "authorized_format" | "engine_switch";
  formatExtension?: string | null;
}

export interface PlaybackErrorClassification {
  category: PlaybackErrorCategory;
  message: string;
  retryable: boolean;
  isDefinitiveCodecDiagnosis: boolean;
  isInconclusive?: boolean;
  httpStatus?: number;
}

export interface PlaybackAttemptPlan {
  primarySource: MediaSourceIdentification;
  attempts: PlaybackAttemptDescriptor[];
  /** Optional secondary candidate when both engine_switch and authorized_format exist; strictly bounded to max 1 executed fallback */
  alternateComplementaryAttempt?: PlaybackAttemptDescriptor | null;
  validationError: PlaybackErrorClassification | null;
}

const NON_MEDIA_PATH_EXTENSIONS = new Set([
  "php",
  "asp",
  "aspx",
  "jsp",
  "cgi",
  "pl",
  "py",
  "do",
  "action",
  "html",
  "htm",
  "json",
  "xml",
  "txt",
  "js",
  "css",
]);

const KNOWN_MEDIA_EXTENSIONS = new Set([
  "m3u8",
  "m3u",
  "ts",
  "mts",
  "m2ts",
  "mp2t",
  "mpegts",
  "mp4",
  "m4v",
  "m4a",
  "mkv",
  "mk3d",
  "mka",
  "webm",
  "avi",
  "mov",
  "qt",
  "flv",
  "f4v",
  "wmv",
  "asf",
  "3gp",
  "3g2",
  "ogg",
  "ogv",
  "oga",
  "mpg",
  "mpeg",
  "mpe",
  "mpv",
  "m2v",
  "vob",
  "divx",
  "xvid",
  "rm",
  "rmvb",
  "mpd",
  "aac",
  "mp3",
  "flac",
  "wav",
  "opus",
  "ac3",
  "eac3",
]);

const FORMAT_QUERY_PARAMETER_KEYS = [
  "output",
  "format",
  "ext",
  "extension",
  "container",
  "stream_type",
  "mime",
  "content_type",
  "type",
] as const;

function classifyTokenAsTransportAndContainer(
  rawToken: string
): { transport: PlaybackTransportMode; container: string; normalizedToken: string } | null {
  const token = rawToken.trim().toLowerCase().replace(/^\.+/, "").split(";")[0].trim();
  if (!token) return null;

  // MIME types or format tokens for HLS manifests
  if (
    token === "m3u8" ||
    token === "m3u" ||
    token === "hls" ||
    token === "application/vnd.apple.mpegurl" ||
    token === "application/x-mpegurl" ||
    token === "audio/mpegurl" ||
    token === "audio/x-mpegurl" ||
    token === "vnd.apple.mpegurl"
  ) {
    return { transport: "hls", container: "hls", normalizedToken: "m3u8" };
  }

  // Continuous MPEG-TS streams (distinct from HLS segments inside an M3U8 manifest)
  if (
    token === "ts" ||
    token === "mts" ||
    token === "m2ts" ||
    token === "mp2t" ||
    token === "mpegts" ||
    token === "video/mp2t" ||
    token === "video/mpeg2ts"
  ) {
    return { transport: "progressive", container: "mpegts", normalizedToken: "ts" };
  }

  if (token === "mp4" || token === "m4v" || token === "m4a" || token === "video/mp4") {
    return { transport: "progressive", container: "mp4", normalizedToken: "mp4" };
  }

  if (
    token === "mkv" ||
    token === "mk3d" ||
    token === "mka" ||
    token === "video/x-matroska" ||
    token === "video/matroska"
  ) {
    return { transport: "progressive", container: "mkv", normalizedToken: "mkv" };
  }

  if (token === "webm" || token === "video/webm" || token === "audio/webm") {
    return { transport: "progressive", container: "webm", normalizedToken: "webm" };
  }

  if (token === "avi" || token === "video/x-msvideo" || token === "video/avi") {
    return { transport: "progressive", container: "avi", normalizedToken: "avi" };
  }

  if (token === "mov" || token === "qt" || token === "video/quicktime") {
    return { transport: "progressive", container: "mov", normalizedToken: "mov" };
  }

  if (token === "flv" || token === "f4v" || token === "video/x-flv") {
    return { transport: "progressive", container: "flv", normalizedToken: "flv" };
  }

  if (
    token === "wmv" ||
    token === "asf" ||
    token === "video/x-ms-wmv" ||
    token === "video/x-ms-asf"
  ) {
    return { transport: "progressive", container: "wmv", normalizedToken: "wmv" };
  }

  if (token === "3gp" || token === "3g2" || token === "video/3gpp" || token === "video/3gpp2") {
    return { transport: "progressive", container: "3gp", normalizedToken: "3gp" };
  }

  if (
    token === "ogg" ||
    token === "ogv" ||
    token === "oga" ||
    token === "video/ogg" ||
    token === "audio/ogg" ||
    token === "application/ogg"
  ) {
    return { transport: "progressive", container: "ogg", normalizedToken: "ogg" };
  }

  if (
    token === "mpg" ||
    token === "mpeg" ||
    token === "mpe" ||
    token === "mpv" ||
    token === "m2v" ||
    token === "vob" ||
    token === "video/mpeg"
  ) {
    return { transport: "progressive", container: "mpeg", normalizedToken: token.startsWith("video/") ? "mpeg" : token };
  }

  if (token === "mpd" || token === "dash" || token === "application/dash+xml") {
    return { transport: "progressive", container: "dash", normalizedToken: "mpd" };
  }

  // Generic video/* or audio/* MIME type
  if (token.startsWith("video/") || token.startsWith("audio/")) {
    const sub = token.slice(token.indexOf("/") + 1).replace(/^x-/, "");
    if (sub && /^[a-z0-9.+-]{2,20}$/.test(sub)) {
      return { transport: "progressive", container: sub, normalizedToken: sub };
    }
  }

  // Custom or provider-declared container extension (never blocked by an artificial whitelist)
  if (/^(?=.*[a-z])[a-z0-9]{2,12}$/.test(token) && !NON_MEDIA_PATH_EXTENSIONS.has(token)) {
    return { transport: "progressive", container: token, normalizedToken: token };
  }

  return null;
}

function extractSafePathnameExtension(
  pathname: string,
  declaredProviderExtension: string | null
): string | null {
  if (!pathname) return null;
  const segments = pathname.split("/");
  const rawLeaf = segments[segments.length - 1] || "";
  if (!rawLeaf) return null;

  let leaf = rawLeaf;
  try {
    leaf = decodeURIComponent(rawLeaf);
  } catch {
    leaf = rawLeaf;
  }

  const lastDotIdx = leaf.lastIndexOf(".");
  if (lastDotIdx <= 0 || lastDotIdx === leaf.length - 1) {
    return null;
  }

  const candidateExt = leaf.slice(lastDotIdx + 1).trim().toLowerCase();
  if (!/^(?=.*[a-z])[a-z0-9]{2,12}$/.test(candidateExt)) {
    return null;
  }

  if (NON_MEDIA_PATH_EXTENSIONS.has(candidateExt)) {
    return null;
  }

  // Accept if it's a recognized media extension OR matches the provider's declared container_extension
  if (
    KNOWN_MEDIA_EXTENSIONS.has(candidateExt) ||
    (declaredProviderExtension && candidateExt === declaredProviderExtension)
  ) {
    return candidateExt;
  }

  return null;
}

function extractFormatFromQueryParams(
  searchParams: URLSearchParams,
  declaredProviderExtension: string | null
): string | null {
  for (const key of FORMAT_QUERY_PARAMETER_KEYS) {
    const values: string[] = [];
    searchParams.forEach((v, k) => {
      if (k.trim().toLowerCase() === key) {
        values.push(v);
      }
    });

    for (const rawVal of values) {
      const cleaned = rawVal.trim().toLowerCase().replace(/^\.+/, "");
      if (!cleaned) continue;
      // Ignore playlist file type descriptors like type=m3u_plus when looking for stream format
      if (key === "type" && (cleaned === "m3u_plus" || cleaned === "enigma216_script")) {
        continue;
      }
      if (
        KNOWN_MEDIA_EXTENSIONS.has(cleaned) ||
        cleaned === "hls" ||
        cleaned.startsWith("application/") ||
        cleaned.startsWith("video/") ||
        cleaned.startsWith("audio/") ||
        (declaredProviderExtension && cleaned === declaredProviderExtension)
      ) {
        return cleaned;
      }
    }
  }
  return null;
}

/**
 * M01 — Intelligent media source identification.
 * - Preserves explicit `contentType` informed by consumer (HLS does not overwrite movie/episode to live).
 * - Never matches arbitrary substrings inside passwords, tokens, titles, or signatures.
 * - Never deduces `conventional_xtream` solely from URL path shape; relies on explicit `sourceOrigin`.
 * - Distinguishes transmission protocol, delivery transport ('hls' | 'progressive' | 'unknown'), and multimedia container.
 */
export function identifyMediaSource(
  options: IdentifyMediaSourceOptions
): MediaSourceIdentification {
  const meta = options.sourceMetadata || null;
  const rawUrl = typeof options.url === "string" ? options.url.trim() : "";
  const rawContentType = options.contentType ?? meta?.contentType ?? null;
  const explicitContentType =
    rawContentType === "live" ||
    rawContentType === "movie" ||
    rawContentType === "episode"
      ? rawContentType
      : null;

  const validDirectSource = normalizeDirectMediaSource(
    options.directSource ?? meta?.directSource
  );
  const explicitOrigin = options.sourceOrigin ?? meta?.sourceOrigin ?? null;
  const isDirectSource =
    explicitOrigin === "direct_source" ||
    Boolean(validDirectSource && validDirectSource === rawUrl);
  const resolvedSourceOrigin: PlaybackSourceOrigin | "unknown" = isDirectSource
    ? "direct_source"
    : explicitOrigin === "conventional_xtream"
      ? "conventional_xtream"
      : "unknown";

  const declaredExt = normalizeContainerExtension(
    options.containerExtension ??
      meta?.declaredContainerExtension ??
      meta?.resolvedContainerExtension
  );
  const declaredMime = extractExplicitMediaMimeType(
    options.mimeType ?? meta?.mimeType
  )?.toLowerCase() ?? null;

  const buildInvalidResult = (): MediaSourceIdentification => ({
    url: rawUrl,
    isValidUrl: false,
    isSupportedProtocol: false,
    protocol: "invalid",
    rawScheme: "",
    transport: "unknown",
    container: "unknown",
    contentType: explicitContentType || "movie",
    detectionSource: "unknown",
    detectedExtension: null,
    detectedMimeType: null,
    sourceOrigin: resolvedSourceOrigin,
    isDirectSource: false,
    isConventionalXtreamLiveUrl: false,
  });

  if (!rawUrl) {
    return buildInvalidResult();
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return buildInvalidResult();
  }

  const rawScheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  const isHttpOrHttps = rawScheme === "http" || rawScheme === "https";
  const isBlobOrData = rawScheme === "blob" || rawScheme === "data";

  if (isHttpOrHttps && !parsed.hostname) {
    return buildInvalidResult();
  }

  const isSupportedProtocol = isHttpOrHttps || isBlobOrData;
  const protocol: PlaybackTransportProtocol = isSupportedProtocol
    ? (rawScheme as "http" | "https" | "blob" | "data")
    : "unsupported";

  const resolvedContentType: PlaybackContentType = (() => {
    if (explicitContentType) return explicitContentType;
    const pathLower = parsed.pathname.toLowerCase();
    if (/(?:^|\/)live\//.test(pathLower)) return "live";
    if (/(?:^|\/)series\//.test(pathLower)) return "episode";
    if (/(?:^|\/)movie\//.test(pathLower)) return "movie";
    return "movie";
  })();

  // Strictly determined by known origin (never guessed from URL path shape)
  const isConventionalXtreamLiveUrl =
    resolvedSourceOrigin === "conventional_xtream" &&
    resolvedContentType === "live" &&
    isHttpOrHttps &&
    !isDirectSource;

  const dataUrlMime =
    rawScheme === "data"
      ? rawUrl.match(/^data:([^;,]+)[;,]/i)?.[1]?.trim().toLowerCase() || null
      : null;
  const effectiveMime = declaredMime || dataUrlMime;

  const makeResult = (
    transport: PlaybackTransportMode,
    container: string,
    detectionSource: PlaybackDetectionSource,
    detectedExtension: string | null,
    detectedMimeType: string | null
  ): MediaSourceIdentification => ({
    url: rawUrl,
    isValidUrl: true,
    isSupportedProtocol,
    protocol,
    rawScheme,
    transport,
    container,
    contentType: resolvedContentType,
    detectionSource,
    detectedExtension,
    detectedMimeType,
    sourceOrigin: resolvedSourceOrigin,
    isDirectSource,
    isConventionalXtreamLiveUrl,
  });

  // Priority 1: Explicit MIME type (or data: URI MIME header)
  if (effectiveMime) {
    const classified = classifyTokenAsTransportAndContainer(effectiveMime);
    if (classified) {
      return makeResult(
        classified.transport,
        classified.container,
        "mime_type",
        classified.normalizedToken,
        effectiveMime
      );
    }
  }

  // Priority 2: Safe leaf pathname extension
  const pathExt =
    rawScheme === "data" ? null : extractSafePathnameExtension(parsed.pathname, declaredExt);
  if (pathExt) {
    const classified = classifyTokenAsTransportAndContainer(pathExt);
    if (classified) {
      return makeResult(
        classified.transport,
        classified.container,
        "pathname_extension",
        pathExt,
        null
      );
    }
  }

  // Priority 3: Recognized format query parameters
  const queryFormat =
    rawScheme === "data" ? null : extractFormatFromQueryParams(parsed.searchParams, declaredExt);
  if (queryFormat) {
    const classified = classifyTokenAsTransportAndContainer(queryFormat);
    if (classified) {
      return makeResult(
        classified.transport,
        classified.container,
        "query_param",
        classified.normalizedToken,
        queryFormat.includes("/") ? queryFormat : null
      );
    }
  }

  // Priority 4: Provider container_extension metadata
  if (declaredExt) {
    const classified = classifyTokenAsTransportAndContainer(declaredExt);
    if (classified) {
      return makeResult(
        classified.transport,
        classified.container,
        "provider_metadata",
        declaredExt,
        null
      );
    }
  }

  // Priority 5: Explicitly unknown transport/container (no unsafe assumptions)
  return makeResult("unknown", "unknown", "unknown", null, null);
}

/**
 * M01 — Coherent playback engine selection based on identified source and environment capabilities.
 */
export function selectPlaybackEngine(
  source: MediaSourceIdentification,
  capabilities: PlaybackEnvironmentCapabilities
): PlaybackEngineSelection {
  if (!source.isValidUrl || !source.isSupportedProtocol) {
    return {
      primaryEngine: null,
      fallbackEngine: null,
      reason: "invalid_or_unsupported_source",
    };
  }

  if (source.transport === "hls") {
    if (capabilities.hlsJsSupported) {
      return {
        primaryEngine: "hls.js",
        fallbackEngine: capabilities.nativeHlsSupported ? "native-hls" : null,
        reason: "hls_via_hlsjs",
      };
    }
    if (capabilities.nativeHlsSupported) {
      return {
        primaryEngine: "native-hls",
        fallbackEngine: null,
        reason: "hls_via_native",
      };
    }
    return {
      primaryEngine: "native",
      fallbackEngine: null,
      reason: "hls_unverified_native_attempt",
    };
  }

  if (source.transport === "progressive") {
    return {
      primaryEngine: "native",
      fallbackEngine: null,
      reason:
        source.container === "mpegts"
          ? "continuous_mpegts_via_native"
          : "progressive_container_via_native",
    };
  }

  // source.transport === 'unknown' (extensionless URL without format query param or container metadata)
  if (source.contentType === "live") {
    if (capabilities.hlsJsSupported) {
      return {
        primaryEngine: "hls.js",
        fallbackEngine: "native",
        reason: "unknown_live_try_hlsjs_then_native",
      };
    }
    if (capabilities.nativeHlsSupported) {
      return {
        primaryEngine: "native-hls",
        fallbackEngine: null,
        reason: "unknown_live_try_native_hls",
      };
    }
    return {
      primaryEngine: "native",
      fallbackEngine: null,
      reason: "unknown_live_try_native",
    };
  }

  // Unknown Movie / Episode source: attempt native HTMLMediaElement first, with 1 controlled HLS fallback if available
  return {
    primaryEngine: "native",
    fallbackEngine: capabilities.hlsJsSupported
      ? "hls.js"
      : capabilities.nativeHlsSupported
        ? "native-hls"
        : null,
    reason: "unknown_vod_try_native_then_hls",
  };
}

/**
 * Strips any URLs, query strings, tokens, or credentials from an error message.
 */
export function sanitizePlaybackErrorMessage(rawMessage: string): string {
  if (!rawMessage || typeof rawMessage !== "string") {
    return "Não foi possível reproduzir esta transmissão.";
  }
  return rawMessage
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, "[endereço ocultado]")
    .replace(/\?[a-z0-9_=&%.-]+/gi, "")
    .replace(/(password|pass|token|sig|signature|auth|key)=[^&\s]+/gi, "$1=[ocultado]")
    .trim();
}

export interface ClassifyPlaybackErrorInput {
  source: MediaSourceIdentification;
  kind: "validation" | "hls" | "native" | "timeout";
  hlsErrorData?: any;
  mediaError?: { code?: number; message?: string } | null;
  httpStatus?: number;
  isMixedContent?: boolean;
  isCorsError?: boolean;
}

/**
 * M01 — Evidence-based playback error classification across all 12 required categories.
 * Never claims a generic browser MEDIA_ERR_SRC_NOT_SUPPORTED proves codec incompatibility,
 * and never exposes authenticated URLs, tokens, passwords, or raw provider messages.
 */
export function classifyPlaybackError(
  input: ClassifyPlaybackErrorInput
): PlaybackErrorClassification {
  const { source, kind, hlsErrorData, mediaError } = input;

  if (!source.isValidUrl) {
    return {
      category: "invalid_url",
      message: "URL de transmissão inválida ou malformada.",
      retryable: false,
      isDefinitiveCodecDiagnosis: false,
    };
  }

  if (!source.isSupportedProtocol) {
    return {
      category: "unsupported_protocol",
      message: "Protocolo de transmissão não suportado por este mecanismo de reprodução.",
      retryable: false,
      isDefinitiveCodecDiagnosis: false,
    };
  }

  if (input.isMixedContent) {
    return {
      category: "cors_or_mixed_content",
      message:
        "Transmissão HTTP bloqueada pelo navegador em contexto seguro HTTPS (Mixed Content).",
      retryable: false,
      isDefinitiveCodecDiagnosis: false,
    };
  }

  if (input.isCorsError) {
    return {
      category: "cors_or_mixed_content",
      message: "Acesso à transmissão bloqueado por política de segurança (CORS).",
      retryable: false,
      isDefinitiveCodecDiagnosis: false,
    };
  }

  if (kind === "timeout") {
    return {
      category: "timeout",
      message: "Tempo limite esgotado ao aguardar resposta do servidor de transmissão.",
      retryable: true,
      isDefinitiveCodecDiagnosis: false,
    };
  }

  const rawHttpStatus =
    input.httpStatus ??
    (typeof hlsErrorData?.response?.code === "number"
      ? hlsErrorData.response.code
      : typeof hlsErrorData?.networkDetails?.status === "number"
        ? hlsErrorData.networkDetails.status
        : undefined);

  if (typeof rawHttpStatus === "number" && rawHttpStatus > 0) {
    if (rawHttpStatus === 429) {
      return {
        category: "rate_limited",
        message:
          "Limite de solicitações excedido no provedor (HTTP 429). Aguarde alguns instantes e tente novamente.",
        retryable: false,
        isDefinitiveCodecDiagnosis: false,
        httpStatus: 429,
      };
    }

    if (rawHttpStatus === 401 || rawHttpStatus === 403) {
      return {
        category: "access_restricted",
        message: "Acesso à transmissão recusado pelo provedor (credenciais ou permissão inválidas).",
        retryable: false,
        isDefinitiveCodecDiagnosis: false,
        httpStatus: rawHttpStatus,
      };
    }

    if (rawHttpStatus === 404 || rawHttpStatus === 410) {
      return {
        category: "source_unavailable",
        message: "Conteúdo ou transmissão não encontrado no provedor.",
        retryable: false,
        isDefinitiveCodecDiagnosis: false,
        httpStatus: rawHttpStatus,
      };
    }

    if (rawHttpStatus >= 500) {
      return {
        category: "network_error",
        message: "Servidor de transmissão temporariamente indisponível no provedor.",
        retryable: true,
        isDefinitiveCodecDiagnosis: false,
        httpStatus: rawHttpStatus,
      };
    }

    if (rawHttpStatus >= 400) {
      return {
        category: "source_unavailable",
        message: "O provedor recusou a solicitação desta transmissão.",
        retryable: false,
        isDefinitiveCodecDiagnosis: false,
        httpStatus: rawHttpStatus,
      };
    }
  }

  if (kind === "hls" && hlsErrorData) {
    const details = String(hlsErrorData.details || "");
    const type = String(hlsErrorData.type || "");

    if (
      details === "manifestLoadTimeOut" ||
      details === "levelLoadTimeOut" ||
      details === "fragLoadTimeOut" ||
      details === "keyLoadTimeOut" ||
      details === "audioTrackLoadTimeOut" ||
      details === "subtitleTrackLoadTimeOut"
    ) {
      return {
        category: "timeout",
        message: "Tempo limite esgotado ao aguardar resposta do servidor de transmissão.",
        retryable: true,
        isDefinitiveCodecDiagnosis: false,
      };
    }

    if (
      details === "manifestIncompatibleCodecsError" ||
      details === "bufferAddCodecError" ||
      details === "bufferIncompatibleCodecsError"
    ) {
      return {
        category: "incompatible_container_or_codec",
        message:
          "Contêiner ou codec da transmissão incompatível com este dispositivo ou navegador.",
        retryable: false,
        isDefinitiveCodecDiagnosis: true,
      };
    }

    if (details === "manifestParsingError" || details === "levelParsingError") {
      return {
        category: "invalid_manifest",
        message: "Manifesto de transmissão HLS inválido ou malformado.",
        retryable: false,
        isDefinitiveCodecDiagnosis: false,
      };
    }

    if (details === "levelEmptyError") {
      return {
        category: "source_unavailable",
        message: "Transmissão sem segmentos de mídia disponíveis no provedor.",
        retryable: false,
        isDefinitiveCodecDiagnosis: false,
      };
    }

    if (
      details === "keyLoadError" ||
      details.startsWith("keySystem")
    ) {
      return {
        category: "access_restricted",
        message: "Acesso à chave de proteção da transmissão recusado pelo provedor.",
        retryable: false,
        isDefinitiveCodecDiagnosis: false,
      };
    }

    if (
      type === "mediaError" ||
      details === "fragParsingError" ||
      details === "fragDecryptError" ||
      details === "bufferAppendError" ||
      details === "bufferAppendingError" ||
      details === "bufferStalledError" ||
      details === "bufferFullError" ||
      details === "bufferSeekOverHole" ||
      details === "bufferNudgeOnStall"
    ) {
      return {
        category: "decode_error",
        message: "Falha ao decodificar o fluxo de áudio ou vídeo durante a reprodução.",
        retryable: type === "mediaError",
        isDefinitiveCodecDiagnosis: false,
      };
    }

    if (
      type === "networkError" ||
      details === "manifestLoadError" ||
      details === "levelLoadError" ||
      details === "fragLoadError"
    ) {
      return {
        category: "network_error",
        message: "Falha de conexão com o servidor de transmissão.",
        retryable: true,
        isDefinitiveCodecDiagnosis: false,
      };
    }

    return {
      category: "source_unavailable",
      message: "Não foi possível iniciar ou manter a reprodução desta transmissão.",
      retryable: false,
      isDefinitiveCodecDiagnosis: false,
    };
  }

  if (kind === "native") {
    const code = mediaError?.code;
    const rawDetailMsg = typeof mediaError?.message === "string" ? mediaError.message : "";

    if (code === 1) {
      return {
        category: "user_aborted",
        message: "Reprodução interrompida pelo usuário.",
        retryable: false,
        isDefinitiveCodecDiagnosis: false,
      };
    }

    if (code === 2) {
      return {
        category: "network_error",
        message: "Falha de rede durante o carregamento da mídia.",
        retryable: true,
        isDefinitiveCodecDiagnosis: false,
      };
    }

    if (code === 3) {
      return {
        category: "decode_error",
        message: "Falha ao decodificar o fluxo de mídia neste dispositivo.",
        retryable: false,
        isDefinitiveCodecDiagnosis: false,
      };
    }

    if (code === 4) {
      // Check if the underlying media engine explicitly reported a concrete demuxer/codec rejection
      const hasConcreteCodecEvidence =
        /DEMUXER_ERROR_NO_SUPPORTED_STREAMS|no supported streams|unsupported codec|codec not supported|audio\/video codec/i.test(
          rawDetailMsg
        );

      if (hasConcreteCodecEvidence) {
        return {
          category: "incompatible_container_or_codec",
          message:
            "Contêiner ou codec de mídia não suportado por este dispositivo ou navegador.",
          retryable: false,
          isDefinitiveCodecDiagnosis: true,
        };
      }

      // Generic MEDIA_ERR_SRC_NOT_SUPPORTED (code 4) without real HTTP status is inconclusive:
      // it may indicate unsupported container/codec, unavailable source, or access restriction (401/403/429).
      const nonStandardContainers = new Set([
        "mpegts",
        "mkv",
        "avi",
        "flv",
        "wmv",
        "mov",
        "3gp",
        "mpeg",
        "divx",
        "xvid",
        "rmvb",
      ]);

      if (nonStandardContainers.has(source.container)) {
        const displayFormat =
          source.container === "mpegts" ? "MPEG-TS" : source.container.toUpperCase();
        return {
          category: "incompatible_container_or_codec",
          message: `Não foi possível reproduzir esta fonte (formato ${displayFormat} pode não ser suportado diretamente pelo navegador, ou há indisponibilidade/restrição de acesso na origem).`,
          retryable: false,
          isDefinitiveCodecDiagnosis: false,
          isInconclusive: true,
        };
      }

      return {
        category: "source_unavailable",
        message:
          "Não foi possível carregar esta transmissão (fonte indisponível no provedor, restrição de acesso ou formato não suportado).",
        retryable: false,
        isDefinitiveCodecDiagnosis: false,
        isInconclusive: true,
      };
    }

    return {
      category: "source_unavailable",
      message: "Não foi possível carregar ou reproduzir esta fonte de mídia.",
      retryable: false,
      isDefinitiveCodecDiagnosis: false,
      isInconclusive: true,
    };
  }

  return {
    category: "source_unavailable",
    message: "Não foi possível reproduzir esta transmissão.",
    retryable: false,
    isDefinitiveCodecDiagnosis: false,
  };
}

export interface BuildPlaybackAttemptPlanOptions extends IdentifyMediaSourceOptions {
  streamId?: string | number | null;
  allowedOutputFormats?: string[] | string | Record<string, unknown> | null;
  capabilities: PlaybackEnvironmentCapabilities;
  isMixedContent?: boolean;
}

/**
 * M01.b — Builds a bounded playback attempt plan (primary attempt + at most 1 complementary attempt).
 * - Never fabricates alternative URLs for `direct_source` or unknown URL origins.
 * - Never replaces movie/episode declared formats (e.g. `.mkv`, `.avi`) with `.mp4`.
 * - For conventional Xtream Live URLs (`sourceOrigin === "conventional_xtream"`), may include
 *   an authorized alternative from `allowed_output_formats` built via `buildDirectMediaUrl()`
 *   using the same channel ID, server, and credentials (never string replacement).
 * - Enforces single-fallback budget (`attempts.length <= 2`; never chains two fallbacks).
 */
export function buildPlaybackAttemptPlan(
  options: BuildPlaybackAttemptPlanOptions
): PlaybackAttemptPlan {
  const primarySource = identifyMediaSource(options);

  if (!primarySource.isValidUrl || !primarySource.isSupportedProtocol) {
    return {
      primarySource,
      attempts: [],
      alternateComplementaryAttempt: null,
      validationError: classifyPlaybackError({
        source: primarySource,
        kind: "validation",
        isMixedContent: options.isMixedContent,
      }),
    };
  }

  const meta = options.sourceMetadata || null;
  const primarySelection = selectPlaybackEngine(primarySource, options.capabilities);
  const primaryFormatExt =
    normalizeContainerExtension(meta?.resolvedContainerExtension) ||
    primarySource.detectedExtension;

  const primaryAttempt: PlaybackAttemptDescriptor = {
    url: primarySource.url,
    engine: primarySelection.primaryEngine || "native",
    source: primarySource,
    isFallback: false,
    formatExtension: primaryFormatExt,
  };

  // Candidate A: Same-URL complementary engine switch
  let engineSwitchCandidate: PlaybackAttemptDescriptor | null = null;
  if (
    primarySelection.fallbackEngine &&
    primarySelection.fallbackEngine !== primaryAttempt.engine
  ) {
    engineSwitchCandidate = {
      url: primarySource.url,
      engine: primarySelection.fallbackEngine,
      source: primarySource,
      isFallback: true,
      fallbackKind: "engine_switch",
      formatExtension: primaryFormatExt,
    };
  }

  // Candidate B: Authorized alternative Live format (ONLY for known conventional Xtream Live URLs)
  let authorizedFormatCandidate: PlaybackAttemptDescriptor | null = null;
  if (primarySource.isConventionalXtreamLiveUrl && !primarySource.isDirectSource) {
    const creds = options.credentials;
    const validStreamId = getValidMediaId(options.streamId ?? meta?.streamId);
    const rawAllowed =
      meta?.allowedOutputFormats !== undefined
        ? meta.allowedOutputFormats
        : options.allowedOutputFormats !== undefined
          ? options.allowedOutputFormats
          : creds?.allowed_output_formats;
    const normalizedAllowed = normalizeAllowedOutputFormats(rawAllowed);

    if (
      creds?.serverUrl &&
      creds.username &&
      creds.password &&
      validStreamId !== null &&
      normalizedAllowed !== undefined &&
      normalizedAllowed.length > 1
    ) {
      const remainingFormats = normalizedAllowed.filter((fmt) => fmt !== primaryFormatExt);
      if (remainingFormats.length > 0) {
        // When primary is non-HLS (e.g. continuous MPEG-TS) and an authorized HLS format exists
        // and the environment supports HLS, prefer that compatible authorized format; otherwise preserve provider order.
        const canUseHls =
          options.capabilities.hlsJsSupported || options.capabilities.nativeHlsSupported;
        const preferredAltFormat =
          (primarySource.transport !== "hls" && canUseHls
            ? remainingFormats.find((fmt) => fmt === "m3u8" || fmt === "hls" || fmt === "m3u")
            : undefined) || remainingFormats[0];

        try {
          const altUrl = buildDirectMediaUrl(creds, {
            type: "live",
            streamId: validStreamId,
            containerExtension: preferredAltFormat,
            allowedOutputFormats: normalizedAllowed,
            directSource: undefined,
          });

          if (altUrl && altUrl !== primarySource.url) {
            const altSource = identifyMediaSource({
              url: altUrl,
              contentType: "live",
              containerExtension: preferredAltFormat,
              sourceOrigin: "conventional_xtream",
              credentials: creds,
            });
            const altSelection = selectPlaybackEngine(altSource, options.capabilities);
            if (altSelection.primaryEngine) {
              authorizedFormatCandidate = {
                url: altUrl,
                engine: altSelection.primaryEngine,
                source: altSource,
                isFallback: true,
                fallbackKind: "authorized_format",
                formatExtension: preferredAltFormat,
              };
            }
          }
        } catch {
          authorizedFormatCandidate = null;
        }
      }
    }
  }

  // Strictly enforce max 2 attempts in plan.attempts (primary + at most 1 complementary).
  // If both candidates exist (e.g. Safari HLS with native-hls AND secondary Live format),
  // keep the primary complementary in attempts[1] and store the other as alternateComplementaryAttempt
  // for failure-driven choice — still strictly bounded to at most 1 executed fallback total.
  const attempts: PlaybackAttemptDescriptor[] = [primaryAttempt];
  let alternateComplementaryAttempt: PlaybackAttemptDescriptor | null = null;

  if (authorizedFormatCandidate && engineSwitchCandidate) {
    if (primarySource.transport === "hls") {
      attempts.push(engineSwitchCandidate);
      alternateComplementaryAttempt = authorizedFormatCandidate;
    } else {
      attempts.push(authorizedFormatCandidate);
      alternateComplementaryAttempt = engineSwitchCandidate;
    }
  } else if (authorizedFormatCandidate) {
    attempts.push(authorizedFormatCandidate);
  } else if (engineSwitchCandidate) {
    attempts.push(engineSwitchCandidate);
  }

  return {
    primarySource,
    attempts,
    alternateComplementaryAttempt,
    validationError: null,
  };
}

/**
 * M01 — Determines whether a failed primary playback attempt is eligible for a single complementary attempt.
 * - Never triggers after stable playback has started (`hasStartedPlaying`).
 * - Never triggers on HTTP 401, 403, 429, Mixed Content/CORS, timeout, or user cancellation.
 * - Conservative on ambiguous native HTMLMediaElement errors without HTTP status when changing URLs.
 */
export function shouldAttemptPlaybackFallback(params: {
  currentAttempt: PlaybackAttemptDescriptor;
  nextAttempt?: PlaybackAttemptDescriptor | null;
  errorClassification: PlaybackErrorClassification;
  hasStartedPlaying: boolean;
}): boolean {
  const { currentAttempt, nextAttempt, errorClassification, hasStartedPlaying } = params;

  if (!nextAttempt || currentAttempt.isFallback) {
    return false;
  }

  if (hasStartedPlaying) {
    return false;
  }

  const { category, httpStatus, isInconclusive, isDefinitiveCodecDiagnosis } = errorClassification;

  // Never use fallback to bypass access restrictions, rate limits, security blocks, timeouts, or user abort
  if (
    category === "access_restricted" ||
    category === "rate_limited" ||
    category === "cors_or_mixed_content" ||
    category === "user_aborted" ||
    category === "invalid_url" ||
    category === "unsupported_protocol" ||
    category === "timeout"
  ) {
    return false;
  }

  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
    return false;
  }

  if (nextAttempt.fallbackKind === "authorized_format") {
    // Only conventional Xtream Live sources may ever switch to an authorized Live format
    if (!currentAttempt.source.isConventionalXtreamLiveUrl || currentAttempt.source.isDirectSource) {
      return false;
    }

    // Conservative behavior on ambiguous native HTMLMediaElement failures (no HTTP status):
    // Only allow URL format change when the primary container is known to be unsupported directly
    // by standard <video> (e.g. continuous MPEG-TS) and the alternative changes transport/engine (e.g. HLS).
    if (isInconclusive && httpStatus === undefined && !isDefinitiveCodecDiagnosis) {
      const isUnsupportedContinuousStream =
        currentAttempt.engine === "native" &&
        currentAttempt.source.container === "mpegts" &&
        nextAttempt.source.transport === "hls";
      return isUnsupportedContinuousStream;
    }

    return (
      category === "incompatible_container_or_codec" ||
      category === "invalid_manifest" ||
      category === "source_unavailable" ||
      category === "decode_error"
    );
  }

  if (nextAttempt.fallbackKind === "engine_switch") {
    if (nextAttempt.url !== currentAttempt.url) {
      return false;
    }

    // Switching from HLS.js to native on an unknown source: only when manifest parsing or codec fails (not 404/network error)
    if (currentAttempt.engine === "hls.js" && nextAttempt.engine === "native") {
      if (httpStatus === 404 || httpStatus === 410) {
        return false;
      }
      return (
        category === "invalid_manifest" ||
        category === "incompatible_container_or_codec"
      );
    }

    // Switching from HLS.js to native-hls on an HLS source: only when MSE/codec/decode fails
    if (currentAttempt.engine === "hls.js" && nextAttempt.engine === "native-hls") {
      return (
        category === "incompatible_container_or_codec" ||
        category === "decode_error"
      );
    }

    // Switching from native HTMLMediaElement to HLS on an unknown VOD source
    if (
      currentAttempt.engine === "native" &&
      (nextAttempt.engine === "hls.js" || nextAttempt.engine === "native-hls")
    ) {
      return (
        category === "source_unavailable" ||
        category === "incompatible_container_or_codec"
      );
    }
  }

  return false;
}

/**
 * M01.b — Selects at most ONE complementary attempt from a PlaybackAttemptPlan based on failure nature.
 * Enforces the single-fallback budget (never executes both engine_switch and authorized_format).
 */
export function selectPlaybackFallbackAttempt(params: {
  plan: PlaybackAttemptPlan;
  currentAttempt: PlaybackAttemptDescriptor;
  errorClassification: PlaybackErrorClassification;
  hasStartedPlaying: boolean;
  fallbackAlreadyUsed: boolean;
}): PlaybackAttemptDescriptor | null {
  const { plan, currentAttempt, errorClassification, hasStartedPlaying, fallbackAlreadyUsed } =
    params;

  if (fallbackAlreadyUsed || currentAttempt.isFallback || hasStartedPlaying) {
    return null;
  }

  const candidates: PlaybackAttemptDescriptor[] = [];
  if (plan.attempts[1]) {
    candidates.push(plan.attempts[1]);
  }
  if (plan.alternateComplementaryAttempt) {
    candidates.push(plan.alternateComplementaryAttempt);
  }

  if (candidates.length === 0) return null;

  // Order candidate preference according to failure nature
  const preferFormatOverEngine =
    errorClassification.category === "invalid_manifest" ||
    errorClassification.category === "source_unavailable";

  const orderedCandidates =
    candidates.length === 2 && preferFormatOverEngine
      ? [...candidates].sort((a, b) =>
          a.fallbackKind === "authorized_format" && b.fallbackKind !== "authorized_format"
            ? -1
            : b.fallbackKind === "authorized_format" && a.fallbackKind !== "authorized_format"
              ? 1
              : 0
        )
      : candidates;

  for (const candidate of orderedCandidates) {
    if (
      shouldAttemptPlaybackFallback({
        currentAttempt,
        nextAttempt: candidate,
        errorClassification,
        hasStartedPlaying,
      })
    ) {
      return candidate;
    }
  }

  return null;
}


