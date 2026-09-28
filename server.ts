import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { xtreamRouter } from "./server/xtreamRouter";
import { mediaRouter } from "./server/mediaRouter";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Middleware to parse JSON bodies for proxy requests
  app.use(express.json({ limit: "1mb" }));

  // Xtream same-origin API proxy route
  app.use("/api/xtream", xtreamRouter);

  // Same-origin media streaming route (HLS & MP4)
  app.use("/api/media", mediaRouter);

  // Direct version endpoint to verify published commit
  app.get("/api/version", (_req, res) => {
    res.redirect("/api/media/version");
  });

  // Vite middleware for development vs static build for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
