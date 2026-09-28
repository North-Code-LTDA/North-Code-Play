import { Router } from "express";
import {
  createMediaTicket,
  handleStreamRequest,
  handleHlsResourceRequest,
  handleImageProxyRequest,
} from "./mediaProxy";
import { XtreamError } from "./ssrf";
import { checkFfmpegAvailable } from "./ffmpegHelper";
import { APP_VERSION, APP_COMMIT, APP_BUILD_TIME } from "../src/version";

export const mediaRouter = Router();

// Version endpoint to easily identify published commit in browser
mediaRouter.get("/version", (_req, res) => {
  res.json({
    name: "North Code Play",
    version: APP_VERSION,
    commit: APP_COMMIT,
    buildTime: APP_BUILD_TIME,
    ffmpegAvailable: checkFfmpegAvailable(),
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
