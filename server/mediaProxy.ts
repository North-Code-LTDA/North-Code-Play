import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { Request, Response } from "express";
import { validateTargetUrl, XtreamError } from "./ssrf";
import { sanitizeForLogs } from "./xtreamProxy";
import {
  checkFfmpegAvailable,
  checkFfprobeAvailable,
  getOrStartLiveRemux,
  getRemuxSession,
  probeMediaStream,
  startVodRemuxStream,
} from "./ffmpegHelper";

export interface MediaTicket {
  id: string;
  serverUrl: string;
  cleanBaseUrl: string;
  username: string;
  password: string;
  type: "live" | "movie" | "series";
  streamId: string;
  ext: string;
  allowedHosts: Set<string>;
  createdAt: number;
  expiresAt: number;
}

// In-memory ticket registry (24 hours TTL)
export const ticketStore = new Map<string, MediaTicket>();

// Periodic cleanup of expired tickets
setInterval(() => {
  const now = Date.now();
  for (const [id, ticket] of ticketStore.entries()) {
    if (now > ticket.expiresAt) {
      ticketStore.delete(id);
    }
  }
}, 60000).unref();

export interface CreateMediaTicketOptions {
  serverUrl: string;
  username: string;
  password: string;
  type: "live" | "movie" | "series";
  streamId: string | number;
  ext?: string;
  allowPrivateForTest?: boolean;
}

/**
 * Creates a validated media playback ticket.
 */
export async function createMediaTicket(
  options: CreateMediaTicketOptions
): Promise<{ ticketId: string; streamUrl: string; ext: string }> {
  const { serverUrl, username, password, type, streamId, ext = "mp4", allowPrivateForTest = false } = options;

  if (!serverUrl || typeof serverUrl !== "string") {
    throw new XtreamError("INVALID_REQUEST", "URL do servidor não informada.", 400);
  }
  if (!username || typeof username !== "string") {
    throw new XtreamError("INVALID_REQUEST", "Usuário não informado.", 400);
  }
  if (!password || typeof password !== "string") {
    throw new XtreamError("INVALID_REQUEST", "Senha não informada.", 400);
  }
  if (!["live", "movie", "series"].includes(type)) {
    throw new XtreamError("INVALID_REQUEST", "Tipo de mídia inválido. Use 'live', 'movie' ou 'series'.", 400);
  }

  const strStreamId = String(streamId).trim();
  if (!/^[a-zA-Z0-9_\-.]+$/.test(strStreamId)) {
    throw new XtreamError("INVALID_REQUEST", "ID do fluxo contém caracteres inválidos.", 400);
  }

  const cleanExt = (ext || (type === "live" ? "m3u8" : "mp4")).toLowerCase().replace(/^\./, "");
  if (!/^[a-zA-Z0-9]+$/.test(cleanExt)) {
    throw new XtreamError("INVALID_REQUEST", "Extensão de mídia inválida.", 400);
  }

  // Validate server URL with SSRF protection
  const { validatedUrl, cleanBaseUrl } = await validateTargetUrl(serverUrl, { allowPrivateForTest });

  const ticketId = `t_${crypto.randomBytes(16).toString("hex")}`;
  const allowedHosts = new Set<string>([validatedUrl.host.toLowerCase()]);

  const ticket: MediaTicket = {
    id: ticketId,
    serverUrl,
    cleanBaseUrl,
    username,
    password,
    type,
    streamId: strStreamId,
    ext: cleanExt,
    allowedHosts,
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 3600 * 1000,
  };

  ticketStore.set(ticketId, ticket);

  const clientExt = type === "live" ? "m3u8" : cleanExt;

  return {
    ticketId,
    streamUrl: `/api/media/stream/${ticketId}/${strStreamId}.${clientExt}`,
    ext: cleanExt,
  };
}

/**
 * Rewrites an arbitrary URI inside an HLS playlist to proxy through same-origin /api/media/hls-resource.
 */
export function rewriteHlsUri(rawUri: string, playlistBaseUrl: URL, ticketId: string): string {
  try {
    const trimmed = rawUri.trim();
    if (!trimmed || trimmed.startsWith("#")) return rawUri;

    // Resolve relative to playlist URL, preserving query parameters and hash
    const resolved = new URL(trimmed, playlistBaseUrl);
    return `/api/media/hls-resource?ticket=${encodeURIComponent(ticketId)}&uri=${encodeURIComponent(resolved.toString())}`;
  } catch {
    return rawUri;
  }
}

/**
 * Parses and rewrites an M3U8 playlist:
 * - Rewrites segment lines
 * - Rewrites URI attribute in #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA, #EXT-X-I-FRAME-STREAM-INF
 */
export function rewriteHlsPlaylist(manifestText: string, playlistBaseUrl: URL, ticketId: string): string {
  const lines = manifestText.split(/\r?\n/);
  const rewrittenLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      rewrittenLines.push(line);
      continue;
    }

    if (!trimmed.startsWith("#")) {
      // It's a segment or variant playlist URI line
      rewrittenLines.push(rewriteHlsUri(trimmed, playlistBaseUrl, ticketId));
      continue;
    }

    // Check tags with URI attributes
    if (
      trimmed.startsWith("#EXT-X-KEY:") ||
      trimmed.startsWith("#EXT-X-MAP:") ||
      trimmed.startsWith("#EXT-X-MEDIA:") ||
      trimmed.startsWith("#EXT-X-I-FRAME-STREAM-INF:")
    ) {
      const replaced = line.replace(/URI=["']([^"']+)["']/g, (_match, uri) => {
        const rewritten = rewriteHlsUri(uri, playlistBaseUrl, ticketId);
        return `URI="${rewritten}"`;
      });
      rewrittenLines.push(replaced);
      continue;
    }

    rewrittenLines.push(line);
  }

  return rewrittenLines.join("\n");
}

/**
 * Handles GET /api/media/stream/:ticket/:filename
 */
export async function handleStreamRequest(
  req: Request,
  res: Response,
  options: { allowPrivateForTest?: boolean } = {}
): Promise<void> {
  try {
    const { ticket: ticketId, filename } = req.params;
    const ticket = ticketStore.get(ticketId);

    if (!ticket || Date.now() > ticket.expiresAt) {
      res.status(404).json({
        error: "TICKET_NOT_FOUND",
        message: "Sessão de transmissão expirada ou não encontrada. Reinicie a reprodução.",
      });
      return;
    }

    // Check if this request is for an active FFmpeg remux segment
    const activeRemux = getRemuxSession(ticketId);
    if (activeRemux && filename && filename.endsWith(".ts")) {
      const segmentFile = path.join(activeRemux.tempDir, path.basename(filename));
      if (fs.existsSync(segmentFile)) {
        res.setHeader("Content-Type", "video/MP2T");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Access-Control-Allow-Origin", "*");
        fs.createReadStream(segmentFile).pipe(res);
        return;
      }
    }

    const { cleanBaseUrl, username, password, type, streamId, ext } = ticket;

    // If channel is live and provider exclusively offers .ts, remux to HLS for browser playback
    if (type === "live" && ext === "ts") {
      const tsTargetUrlStr = `${cleanBaseUrl}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(streamId)}.ts`;
      if (checkFfmpegAvailable()) {
        const { m3u8Path } = await getOrStartLiveRemux(ticket.id, tsTargetUrlStr);
        const m3u8Content = fs.readFileSync(m3u8Path, "utf-8");
        const rewritten = m3u8Content.replace(/^(seg_\d+\.ts)$/gm, `/api/media/stream/${ticket.id}/$1`);
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.status(200).send(rewritten);
        return;
      } else {
        res.status(501).json({
          error: "FFMPEG_REQUIRED",
          message:
            "O canal transmite exclusivamente em MPEG-TS (.ts) sem HLS (.m3u8). É necessário FFmpeg no servidor para remux em HLS no navegador.",
        });
        return;
      }
    }

    // Build target URL
    let targetUrlStr = "";
    if (type === "live") {
      targetUrlStr = `${cleanBaseUrl}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(streamId)}.${ext}`;
    } else if (type === "movie") {
      targetUrlStr = `${cleanBaseUrl}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(streamId)}.${ext}`;
    } else {
      targetUrlStr = `${cleanBaseUrl}/series/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(streamId)}.${ext}`;
    }

    await streamMediaFromUrl({
      req,
      res,
      ticket,
      targetUrlStr,
      isHlsInitial: ext === "m3u8",
      allowPrivateForTest: options.allowPrivateForTest,
      allowLiveFallback: type === "live",
    });
  } catch (err: any) {
    if (res.headersSent) return;
    if (err instanceof XtreamError) {
      res.status(err.statusCode).json({ error: err.code, message: err.message });
      return;
    }
    res.status(502).json({
      error: "STREAM_ERROR",
      message: err?.message || "Erro ao iniciar o fluxo de transmissão.",
    });
  }
}

/**
 * Handles GET /api/media/hls-resource?ticket=...&uri=...
 */
export async function handleHlsResourceRequest(
  req: Request,
  res: Response,
  options: { allowPrivateForTest?: boolean } = {}
): Promise<void> {
  try {
    const ticketId = String(req.query.ticket || "");
    const rawUri = String(req.query.uri || "");

    const ticket = ticketStore.get(ticketId);
    if (!ticket || Date.now() > ticket.expiresAt) {
      res.status(403).json({
        error: "TICKET_INVALID",
        message: "Sessão de transmissão inválida ou expirada.",
      });
      return;
    }

    if (!rawUri) {
      res.status(400).json({
        error: "INVALID_REQUEST",
        message: "URI de recurso não especificada.",
      });
      return;
    }

    // Validate target against SSRF
    const { validatedUrl } = await validateTargetUrl(rawUri, {
      allowPrivateForTest: options.allowPrivateForTest,
    });

    // Verify that the requested host belongs to ticket's allowed hosts (server or redirected CDN)
    const host = validatedUrl.host.toLowerCase();
    if (!ticket.allowedHosts.has(host)) {
      res.status(403).json({
        error: "FORBIDDEN_HOST",
        message: "Acesso a recurso externo não autorizado para esta sessão de mídia.",
      });
      return;
    }

    const isHls = validatedUrl.pathname.endsWith(".m3u8");

    await streamMediaFromUrl({
      req,
      res,
      ticket,
      targetUrlStr: validatedUrl.toString(),
      isHlsInitial: isHls,
      allowPrivateForTest: options.allowPrivateForTest,
      allowLiveFallback: false,
    });
  } catch (err: any) {
    if (res.headersSent) return;
    if (err instanceof XtreamError) {
      res.status(err.statusCode).json({ error: err.code, message: err.message });
      return;
    }
    res.status(502).json({
      error: "RESOURCE_ERROR",
      message: err?.message || "Erro ao carregar recurso da transmissão.",
    });
  }
}

interface StreamMediaOptions {
  req: Request;
  res: Response;
  ticket: MediaTicket;
  targetUrlStr: string;
  isHlsInitial: boolean;
  allowPrivateForTest?: boolean;
  allowLiveFallback?: boolean;
}

/**
 * Common logic to fetch media upstream with manual redirects and stream to client
 */
async function streamMediaFromUrl(options: StreamMediaOptions): Promise<void> {
  const { req, res, ticket, targetUrlStr, isHlsInitial, allowPrivateForTest = false, allowLiveFallback = false } = options;

  let currentUrlStr = targetUrlStr;
  let redirectsCount = 0;
  const maxRedirects = 5;

  const controller = new AbortController();
  req.on("close", () => {
    controller.abort();
  });

  while (redirectsCount <= maxRedirects) {
    // Re-validate against SSRF
    const { validatedUrl } = await validateTargetUrl(currentUrlStr, { allowPrivateForTest });
    ticket.allowedHosts.add(validatedUrl.host.toLowerCase());

    const requestHeaders: Record<string, string> = {
      "User-Agent": "NorthCodePlay/1.0",
      Accept: "*/*",
    };

    // Forward Range header if present
    if (req.headers.range) {
      requestHeaders["Range"] = req.headers.range;
    }

    let upstreamRes: globalThis.Response;
    try {
      upstreamRes = await fetch(currentUrlStr, {
        method: "GET",
        headers: requestHeaders,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err.name === "AbortError" || controller.signal.aborted) {
        return;
      }
      res.status(502).json({
        error: "CONNECTION_FAILED",
        message: "Falha de conexão com o servidor de mídia de origem.",
      });
      return;
    }

    // Handle 3xx Redirects
    if ([301, 302, 303, 307, 308].includes(upstreamRes.status)) {
      redirectsCount++;
      if (redirectsCount > maxRedirects) {
        res.status(502).json({
          error: "INVALID_RESPONSE",
          message: "Excesso de redirecionamentos no servidor de mídia.",
        });
        return;
      }

      const location = upstreamRes.headers.get("location");
      if (!location) {
        res.status(502).json({
          error: "INVALID_RESPONSE",
          message: "Redirecionamento de mídia sem cabeçalho Location.",
        });
        return;
      }

      try {
        const nextUrl = new URL(location, currentUrlStr);
        currentUrlStr = nextUrl.toString();
        continue;
      } catch {
        res.status(502).json({
          error: "INVALID_RESPONSE",
          message: "URL de redirecionamento de mídia inválida.",
        });
        return;
      }
    }

    // If live .m3u8 returned 404 or error, check if provider only offers .ts
    if (upstreamRes.status === 404 && allowLiveFallback && ticket.type === "live") {
      // 1. Try alternative without /live/ if applicable
      if (currentUrlStr.includes("/live/")) {
        const fallbackUrlStr = currentUrlStr.replace("/live/", "/");
        try {
          const fallbackRes = await fetch(fallbackUrlStr, {
            method: "GET",
            headers: requestHeaders,
            redirect: "manual",
            signal: controller.signal,
          });

          if (fallbackRes.ok || fallbackRes.status === 206) {
            upstreamRes = fallbackRes;
            currentUrlStr = fallbackUrlStr;
          }
        } catch {
          // continue
        }
      }

      // 2. If .m3u8 still failed, probe for .ts stream
      if (!upstreamRes.ok && (currentUrlStr.endsWith(".m3u8") || ticket.ext === "m3u8")) {
        const tsUrl = currentUrlStr.replace(/\.m3u8(\?.*)?$/, ".ts$1");
        try {
          const tsProbe = await fetch(tsUrl, {
            method: "HEAD",
            headers: requestHeaders,
            redirect: "manual",
            signal: controller.signal,
          });

          if (tsProbe.ok || tsProbe.status === 206) {
            // Provider only offers .ts!
            if (checkFfmpegAvailable()) {
              // Start FFmpeg remux session to convert live TS into HLS
              const { m3u8Path } = await getOrStartLiveRemux(ticket.id, tsUrl);
              const m3u8Content = fs.readFileSync(m3u8Path, "utf-8");

              // Rewrite segment lines in generated HLS to route via /api/media/stream/:ticket/:segment
              const rewritten = m3u8Content.replace(/^(seg_\d+\.ts)$/gm, `/api/media/stream/${ticket.id}/$1`);

              res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
              res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
              res.setHeader("Access-Control-Allow-Origin", "*");
              res.status(200).send(rewritten);
              return;
            } else {
              res.status(501).json({
                error: "FFMPEG_REQUIRED",
                message:
                  "O canal transmite exclusivamente em MPEG-TS (.ts) sem HLS (.m3u8). É necessário FFmpeg no servidor para remux em HLS no navegador.",
              });
              return;
            }
          }
        } catch {
          // Probe failed
        }
      }
    }

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      res.status(upstreamRes.status).json({
        error: "MEDIA_ERROR",
        message: `Servidor de mídia retornou código de erro HTTP ${upstreamRes.status}.`,
      });
      return;
    }

    const contentType = (upstreamRes.headers.get("content-type") || "").toLowerCase();
    const finalUrlObj = new URL(currentUrlStr);
    const isM3u8Content =
      isHlsInitial ||
      finalUrlObj.pathname.endsWith(".m3u8") ||
      contentType.includes("mpegurl") ||
      contentType.includes("application/x-mpegurl");

    if (isM3u8Content) {
      // HLS Playlist: Read text, rewrite URIs, and return to client
      try {
        const text = await upstreamRes.text();
        const rewritten = rewriteHlsPlaylist(text, finalUrlObj, ticket.id);

        res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.status(200).send(rewritten);
        return;
      } catch {
        res.status(502).json({
          error: "INVALID_RESPONSE",
          message: "Falha ao processar a lista de reprodução HLS.",
        });
        return;
      }
    }

    // Binary Media Stream (MP4, MKV, TS, AAC, etc.)
    const isVod = ticket.type === "movie" || ticket.type === "series";
    const isMkvOrUnsupported =
      ticket.ext === "mkv" ||
      ticket.ext === "avi" ||
      ticket.ext === "flv" ||
      finalUrlObj.pathname.endsWith(".mkv") ||
      finalUrlObj.pathname.endsWith(".avi") ||
      req.query.remux === "1";

    const contentLengthHeader = upstreamRes.headers.get("content-length");
    const contentLengthNum = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;
    const finalUrlLower = currentUrlStr.toLowerCase();

    // Check if provider delivered a substitute/maintenance video with HTTP 200.
    // Small size alone is an indicator (indício), NOT confirmation of maintenance.
    // Confirmed maintenance requires keywords in URL/redirect, maintenance tags, or HTML content.
    const hasMaintenanceKeyword =
      finalUrlLower.includes("maintenance") ||
      finalUrlLower.includes("manutencao") ||
      finalUrlLower.includes("aviso") ||
      finalUrlLower.includes("placeholder") ||
      finalUrlLower.includes("offline") ||
      finalUrlLower.includes("dummy");
    const isHtmlSubstitute = contentType.includes("text/html");
    const hasNoticeHeader = Boolean(
      upstreamRes.headers.get("x-provider-notice") ||
      upstreamRes.headers.get("x-notice") ||
      upstreamRes.headers.get("x-video-notice")
    );

    const isMaintenanceSubstitute =
      isVod &&
      upstreamRes.status === 200 &&
      (hasMaintenanceKeyword || hasNoticeHeader || isHtmlSubstitute);

    if (isMaintenanceSubstitute) {
      res.setHeader("X-NorthCode-Substitute-Video", "true");
      res.setHeader(
        "X-NorthCode-Maintenance-Notice",
        "O provedor entregou um video substituto de manutencao (HTTP 200). A midia real nao esta disponivel na origem."
      );
    }

    // If real VOD in MKV/unsupported container and FFmpeg is available, remux to fragmented MP4
    if (isVod && isMkvOrUnsupported && !isMaintenanceSubstitute && checkFfmpegAvailable()) {
      // Safely close the initial inspection connection before opening a new one with FFmpeg
      if (upstreamRes.body) {
        try {
          await upstreamRes.body.cancel();
        } catch {}
      }
      controller.abort();

      const startSeconds = parseFloat(String(req.query.start || req.query.t || "0")) || 0;
      try {
        const remux = startVodRemuxStream({
          inputUrl: currentUrlStr,
          startSeconds,
        });

        res.status(200);
        res.setHeader("Content-Type", "video/mp4");
        // Live piped remux does not satisfy random byte range requests; do not advertise Accept-Ranges: bytes
        res.setHeader("Accept-Ranges", "none");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("X-NorthCode-Remux", "active");

        remux.stream.pipe(res);

        req.on("close", () => {
          remux.stop();
        });
        return;
      } catch (err: any) {
        console.warn(`[VOD Remux] Falha ao iniciar remux, transmitindo binário direto:`, err?.message);
      }
    }

    res.status(upstreamRes.status);

    // Set appropriate Content-Type
    let streamContentType = upstreamRes.headers.get("content-type");
    if (!streamContentType || streamContentType === "application/octet-stream") {
      if (finalUrlObj.pathname.endsWith(".ts")) {
        streamContentType = "video/MP2T";
      } else if (finalUrlObj.pathname.endsWith(".mp4") || finalUrlObj.pathname.endsWith(".m4v")) {
        streamContentType = "video/mp4";
      } else if (finalUrlObj.pathname.endsWith(".m4s")) {
        streamContentType = "video/iso.segment";
      } else if (finalUrlObj.pathname.endsWith(".aac")) {
        streamContentType = "audio/aac";
      }
    }
    if (streamContentType) {
      res.setHeader("Content-Type", streamContentType);
    }

    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (upstreamRes.headers.get("content-range")) {
      res.setHeader("Content-Range", upstreamRes.headers.get("content-range")!);
    }
    if (upstreamRes.headers.get("content-length")) {
      res.setHeader("Content-Length", upstreamRes.headers.get("content-length")!);
    }

    if (!upstreamRes.body) {
      res.end();
      return;
    }

    // Stream directly to response without loading full file in RAM
    const stream = Readable.fromWeb(upstreamRes.body as any);
    stream.pipe(res);

    req.on("close", () => {
      controller.abort();
      stream.destroy();
    });

    return;
  }
}

/**
 * Standard sleek SVG fallback image when remote images fail, DNS fails, or URL is invalid.
 */
export const FALLBACK_SVG_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="100%" height="100%">
  <rect width="400" height="300" fill="#141418"/>
  <defs>
    <linearGradient id="ncg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1f1f28"/>
      <stop offset="100%" stop-color="#111116"/>
    </linearGradient>
  </defs>
  <rect width="400" height="300" fill="url(#ncg)"/>
  <circle cx="200" cy="125" r="36" fill="#22c55e" opacity="0.12"/>
  <polygon points="192,112 216,125 192,138" fill="#22c55e"/>
  <text x="200" y="195" text-anchor="middle" fill="#a1a1aa" font-family="system-ui, sans-serif" font-size="13" font-weight="600" letter-spacing="1">NORTH CODE PLAY</text>
  <text x="200" y="215" text-anchor="middle" fill="#71717a" font-family="system-ui, sans-serif" font-size="11">Imagem Indisponível</text>
</svg>`;

/**
 * Handles GET /api/media/image?url=...
 * Proxies HTTP/HTTPS images safely, protects against SSRF, and serves SVG fallback on failures.
 * Accurately supports:
 * - Absolute URLs (http:// or https://)
 * - Protocol-relative URLs (starting with //)
 * - Schemeless domain URLs (e.g. images.tmdb.org/...)
 * - Server-relative paths resolved against serverUrl
 * - Accurate status codes (404, 502, 504) so diagnostics can distinguish real vs substitute images
 * - Avoids caching temporary failures for 1 hour (uses no-cache for transient errors)
 * - Maintains SVG visual substitute when image is unavailable
 */
export async function handleImageProxyRequest(
  req: Request,
  res: Response,
  options: { allowPrivateForTest?: boolean } = {}
): Promise<void> {
  const rawUrl = String(req.query.url || "").trim();
  const rawServerUrl = String(req.query.serverUrl || "").trim();
  const isDiagnostic = req.query.diagnose === "1" || req.headers["accept"]?.includes("application/json");

  // If no URL or explicitly requesting fallback
  if (!rawUrl || req.query.fallback === "1") {
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    res.setHeader("X-NorthCode-Image-Real", "false");
    res.setHeader("X-NorthCode-Image-Fallback", "true");
    res.status(200).send(FALLBACK_SVG_IMAGE);
    return;
  }

  // 1. Normalize URL schemes: //, schemeless domain, and relative paths
  let targetUrl = rawUrl;
  if (targetUrl.startsWith("//")) {
    const protocol = rawServerUrl && rawServerUrl.startsWith("http://") ? "http:" : "https:";
    targetUrl = `${protocol}${targetUrl}`;
  } else if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(:\d+)?(\/.*)?$/.test(targetUrl)) {
      targetUrl = `https://${targetUrl}`;
    } else if (rawServerUrl) {
      try {
        const cleanBase = rawServerUrl.endsWith("/") ? rawServerUrl : rawServerUrl + "/";
        targetUrl = new URL(targetUrl.replace(/^\/+/, ""), cleanBase).toString();
      } catch {
        // keep targetUrl as is
      }
    }
  }

  // Helper for diagnostic response
  const sendFailure = (
    statusCode: number,
    errorCode: string,
    message: string,
    isTemporary: boolean,
    redirectChain: any[] = []
  ) => {
    if (res.headersSent) return;

    if (isDiagnostic) {
      res.status(statusCode).json({
        isRealImage: false,
        isFallback: true,
        status: statusCode,
        error: errorCode,
        message,
        targetUrl,
        redirectChain,
      });
      return;
    }

    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("X-NorthCode-Image-Real", "false");
    res.setHeader("X-NorthCode-Image-Fallback", "true");
    res.setHeader("X-NorthCode-Image-Status", String(statusCode));
    res.setHeader("X-NorthCode-Image-Error", errorCode);

    if (isTemporary) {
      // Avoid caching temporary network/server glitches for 1 hour!
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    } else {
      // Short cache for missing images
      res.setHeader("Cache-Control", "public, max-age=300");
    }

    res.status(statusCode).send(FALLBACK_SVG_IMAGE);
  };

  // 2. Fetch Upstream with manual redirect handling and SSRF re-validation at each hop
  let currentUrl = targetUrl;
  let redirectsCount = 0;
  const maxRedirects = 5;
  const redirectChain: Array<{ status: number; location: string; fromUrl: string }> = [];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    let upstreamRes: globalThis.Response | null = null;

    while (redirectsCount <= maxRedirects) {
      // SSRF validation at every step
      let validatedUrl: URL;
      try {
        const result = await validateTargetUrl(currentUrl, {
          allowPrivateForTest: options.allowPrivateForTest,
        });
        validatedUrl = result.validatedUrl;
      } catch (err: any) {
        clearTimeout(timeoutId);
        console.warn(`[Image Proxy] Bloqueio SSRF para imagem: ${sanitizeForLogs(currentUrl)} - Causa: ${err?.message || "Endereço não permitido"}`);
        sendFailure(403, "FORBIDDEN_HOST", err?.message || "Endereço de imagem bloqueado por segurança.", false, redirectChain);
        return;
      }

      // Browser-realistic headers that avoid 403 Forbidden on CDNs (Cloudflare, TMDB, Akamai, etc.)
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
      };

      try {
        upstreamRes = await fetch(validatedUrl.toString(), {
          method: "GET",
          headers,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (err: any) {
        clearTimeout(timeoutId);
        const isTimeout = err?.name === "AbortError" || controller.signal.aborted;
        sendFailure(
          isTimeout ? 504 : 502,
          isTimeout ? "GATEWAY_TIMEOUT" : "CONNECTION_FAILED",
          isTimeout ? "Tempo limite esgotado ao buscar imagem." : "Falha de conexão com o servidor da imagem.",
          true,
          redirectChain
        );
        return;
      }

      // Handle 3xx Redirects
      if ([301, 302, 303, 307, 308].includes(upstreamRes.status)) {
        redirectsCount++;
        const location = upstreamRes.headers.get("location");
        redirectChain.push({
          status: upstreamRes.status,
          location: location || "",
          fromUrl: currentUrl,
        });

        if (!location) {
          clearTimeout(timeoutId);
          sendFailure(502, "INVALID_REDIRECT", "Redirecionamento sem cabeçalho Location.", false, redirectChain);
          return;
        }

        try {
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        } catch {
          clearTimeout(timeoutId);
          sendFailure(502, "INVALID_REDIRECT_URL", "URL de redirecionamento inválida.", false, redirectChain);
          return;
        }
      }

      break;
    }

    clearTimeout(timeoutId);

    if (!upstreamRes) {
      sendFailure(502, "NO_RESPONSE", "Sem resposta do servidor de imagem.", true, redirectChain);
      return;
    }

    if (!upstreamRes.ok) {
      const isTemporary = upstreamRes.status >= 500 || upstreamRes.status === 429;
      sendFailure(
        upstreamRes.status,
        upstreamRes.status === 404 ? "NOT_FOUND" : "UPSTREAM_ERROR",
        `Servidor de origem retornou HTTP ${upstreamRes.status}.`,
        isTemporary,
        redirectChain
      );
      return;
    }

    // Determine content type
    let contentType = (upstreamRes.headers.get("content-type") || "").toLowerCase().split(";")[0].trim();
    if (!contentType || contentType === "application/octet-stream") {
      const lower = currentUrl.toLowerCase();
      if (lower.endsWith(".png")) contentType = "image/png";
      else if (lower.endsWith(".webp")) contentType = "image/webp";
      else if (lower.endsWith(".gif")) contentType = "image/gif";
      else if (lower.endsWith(".svg")) contentType = "image/svg+xml";
      else if (lower.endsWith(".avif")) contentType = "image/avif";
      else contentType = "image/jpeg";
    }

    if (!contentType.startsWith("image/") && !contentType.includes("octet-stream")) {
      sendFailure(502, "INVALID_CONTENT_TYPE", `Conteúdo retornado não é imagem (${contentType}).`, false, redirectChain);
      return;
    }

    if (isDiagnostic) {
      res.status(200).json({
        isRealImage: true,
        isFallback: false,
        status: 200,
        contentType,
        finalUrl: currentUrl,
        redirectChain,
      });
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-NorthCode-Image-Real", "true");
    res.setHeader("X-NorthCode-Image-Fallback", "false");

    if (!upstreamRes.body) {
      res.end();
      return;
    }

    const stream = Readable.fromWeb(upstreamRes.body as any);
    stream.pipe(res);
  } catch (err: any) {
    clearTimeout(timeoutId);
    sendFailure(502, "UNEXPECTED_ERROR", err?.message || "Erro inesperado ao buscar imagem.", true, redirectChain);
  }
}

export interface UpstreamProbeDetail {
  requestedExt: string;
  initialUrl: string;
  redirectChain: Array<{
    status: number;
    location: string;
    fromUrl: string;
  }>;
  finalUrl: string;
  httpStatus: number;
  contentType: string;
  contentLength: number | null;
  acceptRangesHeader: string | null;
  rangeSupported: boolean;
  isMaintenanceVideo: boolean;
  maintenanceReason?: string;
  isCorrectMedia: boolean;
  isLowSize?: boolean;
  ffprobe?: {
    duration?: number;
    formatName?: string;
    videoCodec?: string;
    audioCodec?: string;
  };
  recommendation?: string;
}

export interface MediaDiagnosticReport {
  ticketId?: string;
  mediaType: "live" | "movie" | "series";
  streamId: string;
  requestedFormat: string;
  recommendedExtension?: string;
  primaryProbe: UpstreamProbeDetail;
  alternativeProbe?: UpstreamProbeDetail;
  conclusion: {
    causeConfirmed: boolean;
    category:
      | "MAINTENANCE_VIDEO"
      | "FORMAT_INCOMPATIBLE"
      | "EXTENSION_MISMATCH"
      | "ORIGIN_ERROR"
      | "READY_NATIVE";
    message: string;
    transcodingWillFix: boolean;
  };
}

/**
 * Probes a single upstream media URL to inspect redirects, status, Range support, and maintenance videos.
 */
async function probeSingleUpstreamUrl(
  urlStr: string,
  ext: string,
  mediaType: "live" | "movie" | "series",
  options: { allowPrivateForTest?: boolean } = {}
): Promise<UpstreamProbeDetail> {
  let currentUrl = urlStr;
  let redirectsCount = 0;
  const maxRedirects = 5;
  const redirectChain: Array<{ status: number; location: string; fromUrl: string }> = [];

  let finalRes: globalThis.Response | null = null;

  while (redirectsCount <= maxRedirects) {
    const { validatedUrl } = await validateTargetUrl(currentUrl, {
      allowPrivateForTest: options.allowPrivateForTest,
    });

    const res = await fetch(validatedUrl.toString(), {
      method: "GET",
      headers: {
        "User-Agent": "NorthCodePlay/1.0",
        Range: "bytes=0-1023", // Test Range support and grab headers
      },
      redirect: "manual",
    });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      redirectsCount++;
      const location = res.headers.get("location") || "";
      redirectChain.push({
        status: res.status,
        location,
        fromUrl: currentUrl,
      });

      if (!location) {
        finalRes = res;
        break;
      }

      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    finalRes = res;
    break;
  }

  const httpStatus = finalRes ? finalRes.status : 0;
  const contentType = finalRes?.headers.get("content-type") || "unknown";
  const acceptRangesHeader = finalRes?.headers.get("accept-ranges") || null;
  const contentRange = finalRes?.headers.get("content-range") || "";

  // Content length: if partial content 206, content-range has format "bytes 0-1023/total"
  let contentLength: number | null = null;
  if (contentRange && contentRange.includes("/")) {
    const total = contentRange.split("/")[1];
    if (total && total !== "*") {
      contentLength = parseInt(total, 10);
    }
  }
  if (contentLength === null && finalRes?.headers.get("content-length")) {
    contentLength = parseInt(finalRes.headers.get("content-length")!, 10);
  }

  const rangeSupported = httpStatus === 206 || (acceptRangesHeader?.toLowerCase() === "bytes");

  const finalUrlLower = currentUrl.toLowerCase();
  const isVod = mediaType === "movie" || mediaType === "series";

  // Maintenance video heuristics
  let isMaintenanceVideo = false;
  let maintenanceReason: string | undefined;
  const isLowSize = contentLength !== null && contentLength > 0 && contentLength < 6 * 1024 * 1024;

  const hasMaintenanceKeyword =
    finalUrlLower.includes("maintenance") ||
    finalUrlLower.includes("manutencao") ||
    finalUrlLower.includes("aviso") ||
    finalUrlLower.includes("placeholder") ||
    finalUrlLower.includes("offline") ||
    finalUrlLower.includes("dummy");

  const hasNoticeHeader = Boolean(
    finalRes?.headers.get("x-provider-notice") ||
    finalRes?.headers.get("x-notice") ||
    finalRes?.headers.get("x-video-notice")
  );

  if (isVod && (httpStatus === 200 || httpStatus === 206)) {
    if (hasMaintenanceKeyword || hasNoticeHeader) {
      isMaintenanceVideo = true;
      maintenanceReason = "URL final, redirecionamento ou cabeçalhos do provedor indicam vídeo de manutenção.";
    } else if (contentType.includes("text/html")) {
      isMaintenanceVideo = true;
      maintenanceReason = "Origem retornou resposta HTML (página de manutenção/aviso) em vez de vídeo.";
    }
  }

  // Run ffprobe if available
  let probeDetails: any = undefined;
  if (checkFfprobeAvailable() && (httpStatus === 200 || httpStatus === 206)) {
    try {
      const probeResult = await probeMediaStream(currentUrl, 5000);
      probeDetails = {
        duration: probeResult.duration,
        formatName: probeResult.formatName,
        videoCodec: probeResult.videoCodec,
        audioCodec: probeResult.audioCodec,
      };
      if (probeResult.isMaintenanceVideo && !isMaintenanceVideo) {
        isMaintenanceVideo = true;
        maintenanceReason = probeResult.maintenanceReason || "Tags de metadados indicam aviso de manutenção.";
      }
    } catch {}
  }

  const isCorrectMedia = !isMaintenanceVideo && (httpStatus === 200 || httpStatus === 206);

  let recommendation = "";
  if (isMaintenanceVideo) {
    recommendation = "O servidor entregou um vídeo substituto de manutenção. Transcodificação não corrigirá um conteúdo que a origem não forneceu.";
  } else if (!isCorrectMedia) {
    recommendation = `Servidor de origem retornou status HTTP ${httpStatus}. Verifique se o conteúdo está ativo no provedor.`;
  } else if (ext === "mkv" || contentType.includes("matroska")) {
    recommendation = "Mídia real entregue pela origem em MKV. Remux para MP4/AAC habilitará reprodução web com avanço e retrocesso.";
  } else {
    recommendation = "Mídia real entregue pela origem pronta para reprodução.";
  }

  return {
    requestedExt: ext,
    initialUrl: urlStr,
    redirectChain,
    finalUrl: currentUrl,
    httpStatus,
    contentType,
    contentLength,
    acceptRangesHeader,
    rangeSupported,
    isMaintenanceVideo,
    maintenanceReason,
    isCorrectMedia,
    isLowSize,
    ffprobe: probeDetails,
    recommendation,
  };
}

export interface DiagnoseMediaOptions {
  ticketId?: string;
  serverUrl?: string;
  username?: string;
  password?: string;
  type?: "live" | "movie" | "series";
  streamId?: string | number;
  ext?: string;
  allowPrivateForTest?: boolean;
}

/**
 * Comprehensive upstream media diagnostic:
 * - Traces requested extension and alternative extension (e.g. mp4 vs mkv)
 * - Records HTTP status, redirect chain, Content-Type, Content-Length, Range support
 * - Determines whether origin delivered the real media or a substitute maintenance video
 * - Declares confirmed cause and forbids claiming transcoding fixes unavailable content
 */
export async function diagnoseMediaUpstream(options: DiagnoseMediaOptions): Promise<MediaDiagnosticReport> {
  let cleanBaseUrl = "";
  let username = "";
  let password = "";
  let type: "live" | "movie" | "series" = "movie";
  let streamId = "";
  let requestedExt = "mp4";
  let ticketId: string | undefined = options.ticketId;

  if (ticketId) {
    const ticket = ticketStore.get(ticketId);
    if (!ticket) {
      throw new XtreamError("TICKET_NOT_FOUND", "Ticket não encontrado para diagnóstico.", 404);
    }
    cleanBaseUrl = ticket.cleanBaseUrl;
    username = ticket.username;
    password = ticket.password;
    type = ticket.type;
    streamId = ticket.streamId;
    requestedExt = ticket.ext;
  } else {
    if (!options.serverUrl || !options.username || !options.password || !options.streamId) {
      throw new XtreamError("INVALID_REQUEST", "Parâmetros insuficientes para diagnóstico de mídia.", 400);
    }
    const { cleanBaseUrl: validatedBase } = await validateTargetUrl(options.serverUrl, {
      allowPrivateForTest: options.allowPrivateForTest,
    });
    cleanBaseUrl = validatedBase;
    username = options.username;
    password = options.password;
    type = options.type || "movie";
    streamId = String(options.streamId);
    requestedExt = (options.ext || (type === "live" ? "m3u8" : "mp4")).toLowerCase().replace(/^\./, "");
  }

  // Build target URL for primary requested extension
  const primaryUrl = `${cleanBaseUrl}/${type}/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(streamId)}.${requestedExt}`;

  const primaryProbe = await probeSingleUpstreamUrl(primaryUrl, requestedExt, type, {
    allowPrivateForTest: options.allowPrivateForTest,
  });

  let alternativeProbe: UpstreamProbeDetail | undefined = undefined;

  // For VOD, probe alternate extension to compare cases
  if (type !== "live") {
    const altExt = requestedExt === "mp4" ? "mkv" : "mp4";
    const altUrl = `${cleanBaseUrl}/${type}/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(streamId)}.${altExt}`;
    try {
      alternativeProbe = await probeSingleUpstreamUrl(altUrl, altExt, type, {
        allowPrivateForTest: options.allowPrivateForTest,
      });
    } catch {}
  }

  // Derive final diagnosis conclusion
  let category: MediaDiagnosticReport["conclusion"]["category"] = "READY_NATIVE";
  let message = "";
  let transcodingWillFix = false;
  let recommendedExtension: string | undefined = undefined;

  if (primaryProbe.isMaintenanceVideo) {
    if (alternativeProbe && alternativeProbe.isCorrectMedia) {
      category = "EXTENSION_MISMATCH";
      transcodingWillFix = true;
      recommendedExtension = alternativeProbe.requestedExt;
      message = `Causa confirmada: A extensão solicitada (.${primaryProbe.requestedExt}) entregou o vídeo de manutenção do provedor, mas a extensão alternativa (.${alternativeProbe.requestedExt}) contém o arquivo real (${Math.round((alternativeProbe.contentLength || 0) / (1024 * 1024))} MB). O sistema selecionará automaticamente .${alternativeProbe.requestedExt} com remux.`;
    } else {
      category = "MAINTENANCE_VIDEO";
      transcodingWillFix = false;
      message = `Causa confirmada: O servidor de origem (provedor) entregou um vídeo substituto de manutenção com HTTP ${primaryProbe.httpStatus}. O conteúdo solicitado não está disponível no catálogo do provedor. A transcodificação NÃO corrigirá este problema porque a origem não forneceu o arquivo real.`;
    }
  } else if (primaryProbe.httpStatus >= 400) {
    if (alternativeProbe && alternativeProbe.isCorrectMedia) {
      category = "EXTENSION_MISMATCH";
      transcodingWillFix = true;
      recommendedExtension = alternativeProbe.requestedExt;
      message = `Causa confirmada: A extensão .${primaryProbe.requestedExt} retornou HTTP ${primaryProbe.httpStatus}, mas o arquivo existe no formato alternativo .${alternativeProbe.requestedExt}.`;
    } else {
      category = "ORIGIN_ERROR";
      transcodingWillFix = false;
      message = `Causa confirmada: O servidor do provedor retornou código de erro HTTP ${primaryProbe.httpStatus}.`;
    }
  } else if (primaryProbe.isCorrectMedia && (primaryProbe.requestedExt === "mkv" || primaryProbe.contentType.includes("matroska"))) {
    category = "FORMAT_INCOMPATIBLE";
    transcodingWillFix = true;
    message = `Causa confirmada: A origem forneceu o conteúdo correto (${Math.round((primaryProbe.contentLength || 0) / (1024 * 1024))} MB), mas o formato (.mkv) ou codec de áudio não é reproduzível nativamente no navegador. O remux sob demanda via FFmpeg no servidor habilita a reprodução com suporte a avanço e retrocesso.`;
  } else if (primaryProbe.isCorrectMedia) {
    category = "READY_NATIVE";
    transcodingWillFix = false;
    message = "A mídia foi entregue corretamente pela origem em formato nativo compatível com o navegador.";
  }

  return {
    ticketId,
    mediaType: type,
    streamId,
    requestedFormat: requestedExt,
    recommendedExtension,
    primaryProbe,
    alternativeProbe,
    conclusion: {
      causeConfirmed: true,
      category,
      message,
      transcodingWillFix,
    },
  };
}
