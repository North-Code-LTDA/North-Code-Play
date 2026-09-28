import { Router } from "express";
import {
  createMediaTicket,
  handleStreamRequest,
  handleHlsResourceRequest,
  handleImageProxyRequest,
  diagnoseMediaUpstream,
  ticketStore,
} from "./mediaProxy";
import { XtreamError } from "./ssrf";
import { checkFfmpegAvailable, checkFfprobeAvailable } from "./ffmpegHelper";
import { APP_VERSION, APP_COMMIT, APP_BUILD_TIME } from "../src/version";

export const mediaRouter = Router();

// Version endpoint to easily identify published commit in browser
mediaRouter.get("/version", (_req, res) => {
  const commit = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || APP_COMMIT;
  res.json({
    name: "North Code Play",
    version: APP_VERSION,
    commit,
    buildTime: APP_BUILD_TIME,
    ffmpegAvailable: checkFfmpegAvailable(),
    ffprobeAvailable: checkFfprobeAvailable(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Image Proxy route
mediaRouter.get("/image", async (req, res) => {
  await handleImageProxyRequest(req, res);
});

// Create media playback ticket
mediaRouter.post("/ticket", async (req, res) => {
  try {
    const { serverUrl, username, password, type, streamId, ext } = req.body || {};

    const ticketResult = await createMediaTicket({
      serverUrl,
      username,
      password,
      type,
      streamId,
      ext,
    });

    res.status(200).json(ticketResult);
  } catch (err: any) {
    if (err instanceof XtreamError) {
      res.status(err.statusCode).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({
      error: "TICKET_CREATION_FAILED",
      message: err?.message || "Falha ao criar ticket de reprodução de mídia.",
    });
  }
});

// Stream endpoint (HLS playlists, video segments, MP4 files)
mediaRouter.get("/stream/:ticket/:filename", async (req, res) => {
  await handleStreamRequest(req, res);
});

// HLS sub-resource proxy (sub-playlists, segments, encryption keys)
mediaRouter.get("/hls-resource", async (req, res) => {
  await handleHlsResourceRequest(req, res);
});

// Diagnostic endpoint: GET /api/media/diagnose/:ticket
mediaRouter.get("/diagnose/:ticket", async (req, res) => {
  try {
    const { ticket: ticketId } = req.params;
    const report = await diagnoseMediaUpstream({ ticketId });
    res.status(200).json(report);
  } catch (err: any) {
    if (err instanceof XtreamError) {
      res.status(err.statusCode).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({
      error: "DIAGNOSTIC_FAILED",
      message: err?.message || "Falha ao executar diagnóstico da transmissão.",
    });
  }
});

// Diagnostic endpoint: POST /api/media/diagnose
mediaRouter.post("/diagnose", async (req, res) => {
  try {
    const { ticketId, serverUrl, username, password, type, streamId, ext } = req.body || {};
    const report = await diagnoseMediaUpstream({
      ticketId,
      serverUrl,
      username,
      password,
      type,
      streamId,
      ext,
    });
    res.status(200).json(report);
  } catch (err: any) {
    if (err instanceof XtreamError) {
      res.status(err.statusCode).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({
      error: "DIAGNOSTIC_FAILED",
      message: err?.message || "Falha ao executar diagnóstico da transmissão.",
    });
  }
});

// Switch extension endpoint: POST /api/media/switch-extension
mediaRouter.post("/switch-extension", async (req, res) => {
  try {
    const { ticketId, newExt, allowPrivateForTest } = req.body || {};
    if (!ticketId || !newExt) {
      res.status(400).json({
        error: "INVALID_REQUEST",
        message: "ticketId e newExt são obrigatórios para alternar a extensão da mídia.",
      });
      return;
    }

    const ticket = ticketStore.get(ticketId);
    if (!ticket) {
      res.status(404).json({
        error: "TICKET_NOT_FOUND",
        message: "Sessão de transmissão expirada ou não encontrada.",
      });
      return;
    }

    const cleanExt = String(newExt).trim().toLowerCase().replace(/^\./, "");
    const newTicket = await createMediaTicket({
      serverUrl: ticket.cleanBaseUrl,
      username: ticket.username,
      password: ticket.password,
      type: ticket.type,
      streamId: ticket.streamId,
      ext: cleanExt,
      allowPrivateForTest: allowPrivateForTest || ticket.cleanBaseUrl.includes("127.0.0.1"),
    });

    res.status(200).json(newTicket);
  } catch (err: any) {
    if (err instanceof XtreamError) {
      res.status(err.statusCode).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({
      error: "SWITCH_FAILED",
      message: err?.message || "Falha ao alternar extensão da mídia.",
    });
  }
});
