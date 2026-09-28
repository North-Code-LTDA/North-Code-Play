import { Router, Request, Response } from "express";
import {
  createMediaTicket,
  handleStreamRequest,
  handleHlsResourceRequest,
} from "./mediaProxy";
import { XtreamError } from "./ssrf";

export const mediaRouter = Router();

// Endpoint to generate a playback ticket
mediaRouter.post("/ticket", async (req: Request, res: Response) => {
  try {
    const { serverUrl, username, password, type, streamId, ext } = req.body || {};

    const result = await createMediaTicket({
      serverUrl,
      username,
      password,
      type,
      streamId,
      ext,
    });

    res.status(200).json(result);
  } catch (err: any) {
    if (err instanceof XtreamError) {
      res.status(err.statusCode).json({
        error: err.code,
        message: err.message,
      });
      return;
    }

    res.status(502).json({
      error: "TICKET_CREATION_FAILED",
      message: "Falha ao criar sessão de reprodução segura.",
    });
  }
});

// Endpoint for streaming initial media file (HLS playlist or MP4)
mediaRouter.get("/stream/:ticket/:filename", async (req: Request, res: Response) => {
  try {
    await handleStreamRequest(req, res);
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(502).json({
        error: "STREAM_ERROR",
        message: "Erro durante a transmissão do fluxo de mídia.",
      });
    }
  }
});

// Endpoint for HLS sub-resources (segments, keys, sub-playlists, maps)
mediaRouter.get("/hls-resource", async (req: Request, res: Response) => {
  try {
    await handleHlsResourceRequest(req, res);
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(502).json({
        error: "RESOURCE_ERROR",
        message: "Erro ao carregar o segmento da transmissão.",
      });
    }
  }
});
