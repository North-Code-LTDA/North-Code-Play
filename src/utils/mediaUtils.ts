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

