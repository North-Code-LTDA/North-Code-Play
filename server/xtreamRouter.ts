import { Router, Request, Response } from "express";
import { executeXtreamQuery, checkRateLimit, sanitizeForLogs } from "./xtreamProxy";
import { XtreamError } from "./ssrf";

export const xtreamRouter = Router();

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "127.0.0.1";
}

async function handleXtreamRequest(req: Request, res: Response, defaultAction?: string) {
  try {
    const clientIp = getClientIp(req);
    checkRateLimit(clientIp);

    const { serverUrl, username, password, action, params } = req.body || {};

    const targetAction = defaultAction || action || "auth";

    const data = await executeXtreamQuery({
      serverUrl,
      username,
      password,
      action: targetAction,
      params,
    });

    return res.status(200).json(data);
  } catch (err: any) {
    if (err instanceof XtreamError) {
      return res.status(err.statusCode).json({
        error: err.code,
        message: err.message,
      });
    }

    // Generic safe error fallback - do not leak stack traces or credentials
    const safeMsg = sanitizeForLogs(err?.message || "Erro desconhecido");
    console.error(`[Xtream Proxy Error] ${safeMsg}`);

    return res.status(502).json({
      error: "CONNECTION_FAILED",
      message: "Falha ao processar requisição com o servidor Xtream.",
    });
  }
}

// Main Xtream Proxy endpoint
xtreamRouter.post("/", async (req, res) => {
  await handleXtreamRequest(req, res);
});

// Dedicated Auth endpoint for convenience
xtreamRouter.post("/auth", async (req, res) => {
  await handleXtreamRequest(req, res, "auth");
});
