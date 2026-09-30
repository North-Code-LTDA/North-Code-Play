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
    try {
      const cleanBase = normalizeServerUrl(effectiveBase);
      const baseWithSlash = cleanBase.endsWith("/") ? cleanBase : `${cleanBase}/`;
      const resolved = new URL(trimmed, baseWithSlash);
      return resolved.href;
    } catch {
      const cleanBase = normalizeServerUrl(effectiveBase);
      const relativePart = trimmed.replace(/^\/+/, "");
      return `${cleanBase}/${relativePart}`;
    }
  }

  return null;
}

/**
 * Diagnostic record comparing raw API image string with legacy browser resolution and normalized URL.
 */
export interface ImageUrlDiagnosis {
  rawUrl: unknown;
  serverUrl: string | null | undefined;
  legacyBrowserResolution: string;
  resolvedUrl: string | null;
  isIdenticalToLegacy: boolean;
  wasModifiedByNormalizer: boolean;
  isAbsolute: boolean;
  isLegacyProxy: boolean;
  diffCategory:
    | "identical"
    | "relative_resolved_to_provider"
    | "legacy_proxy_extracted"
    | "modified_by_normalizer"
    | "empty_source";
  notes: string;
}

/**
 * Compares raw API image URL against legacy browser resolution (<img src={rawUrl}>)
 * and the URL generated by buildDirectImageUrl.
 */
export function diagnoseImageUrl(
  rawUrl?: unknown,
  serverUrl?: string | null
): ImageUrlDiagnosis {
  const normalized = normalizeImageSource(rawUrl);
  const resolved = buildDirectImageUrl(rawUrl, serverUrl);

  const trimmed = normalized || "";
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
  const isIdentical = legacyResolution === (resolved || "");
  const wasModified = isAbs && resolved !== trimmed;

  let diffCategory: ImageUrlDiagnosis["diffCategory"] = "identical";
  let notes = "";

  if (!trimmed || !resolved) {
    diffCategory = "empty_source";
    notes = "Fonte vazia, nula ou inválida; área reservada é mantida sem renderizar tag <img>.";
  } else if (legacyProxy) {
    diffCategory = "legacy_proxy_extracted";
    notes = "Link herdado do antigo proxy (/api/media/image) extraído com sucesso para conexão direta.";
  } else if (isAbs) {
    if (wasModified) {
      diffCategory = "modified_by_normalizer";
      notes = "ALERTA: URL absoluta foi modificada pelo normalizador!";
    } else {
      diffCategory = "identical";
      notes = "URL absoluta intacta, rigorosamente idêntica ao commit de referência.";
    }
  } else {
    diffCategory = "relative_resolved_to_provider";
    notes = `Caminho relativo resolvido diretamente contra o servidor IPTV (${resolved}).`;
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
  (window as any).ncTestImage = (url: unknown, sUrl?: string) => {
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
 */
export function buildDirectMediaUrl(
  credentials: Pick<XtreamCredentials, "serverUrl" | "username" | "password">,
  options: BuildDirectMediaUrlOptions
): string {
  const { type, streamId, containerExtension, allowedOutputFormats, directSource } = options;

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
