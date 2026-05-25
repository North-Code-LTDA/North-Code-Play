import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import axios from "axios";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Endpoint to proxy video streams and JSON API requests
  app.get("/api/proxy", async (req, res) => {
    // Enable CORS for the proxy
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");

    if (req.method === "OPTIONS") {
      res.status(200).end();
      return;
    }

    try {
      const targetUrl = req.query.url as string;
      if (!targetUrl) {
        res.status(400).send("No target URL");
        return;
      }

      // We only proxy API requests now. Media goes directly to the browser (Direct Play).
      try {
        const response = await fetch(targetUrl);
        const text = await response.text();
        try {
          const json = JSON.parse(text);
          res.json(json);
        } catch (e) {
          res.send(text);
        }
      } catch (error: any) {
        console.error("[API Proxy Error]:", error.message);
        res.status(500).json({ error: error.message || "Failed to fetch from proxy" });
      }
    } catch (error: any) {
      console.error("[Stream Proxy Global Error]:", error.message);
      if (!res.headersSent) {
         res.status(500).end();
      }
    }
  });

  // Vite middleware for development
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
