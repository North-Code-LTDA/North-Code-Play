import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { Request, Response } from "express";
import { validateTargetUrl, XtreamError } from "./ssrf";
import { sanitizeForLogs } from "./xtreamProxy";
import { checkFfmpegAvailable, getOrStartLiveRemux, getRemuxSession } from "./ffmpegHelper";

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
            // Provedor only offers .ts!
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

    // Binary Media Stream (MP4, TS, AAC, etc.)
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
 */
export async function handleImageProxyRequest(
  req: Request,
  res: Response,
  options: { allowPrivateForTest?: boolean } = {}
): Promise<void> {
  const rawUrl = String(req.query.url || "").trim();

  // If no URL or explicitly requesting fallback
  if (!rawUrl || req.query.fallback === "1") {
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    res.status(200).send(FALLBACK_SVG_IMAGE);
    return;
  }

  // 1. SSRF Validation
  let validatedUrl: URL;
  try {
    const result = await validateTargetUrl(rawUrl, {
      allowPrivateForTest: options.allowPrivateForTest,
    });
    validatedUrl = result.validatedUrl;
  } catch (err: any) {
    console.warn(`[Image Proxy] Bloqueio SSRF para imagem: ${sanitizeForLogs(rawUrl)} - Causa: ${err?.message || "Endereço não permitido"}`);
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).send(FALLBACK_SVG_IMAGE);
    return;
  }

  // 2. Fetch Upstream with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const upstream = await fetch(validatedUrl.toString(), {
      method: "GET",
      headers: {
        "User-Agent": "NorthCodePlay/1.0",
        Accept: "image/*,*/*;q=0.8",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!upstream.ok) {
      console.warn(`[Image Proxy] Erro HTTP ${upstream.status} ao buscar imagem: ${sanitizeForLogs(rawUrl)}`);
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.status(200).send(FALLBACK_SVG_IMAGE);
      return;
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/") && !contentType.includes("octet-stream")) {
      console.warn(`[Image Proxy] Conteúdo não é imagem (${contentType}): ${sanitizeForLogs(rawUrl)}`);
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.status(200).send(FALLBACK_SVG_IMAGE);
      return;
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (!upstream.body) {
      res.end();
      return;
    }

    const stream = Readable.fromWeb(upstream.body as any);
    stream.pipe(res);
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.warn(`[Image Proxy] Falha de conexão/DNS na imagem: ${sanitizeForLogs(rawUrl)} - Causa: ${err?.message || "Erro de rede"}`);
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).send(FALLBACK_SVG_IMAGE);
  }
}
