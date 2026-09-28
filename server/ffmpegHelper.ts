import { spawn, spawnSync, ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let cachedFfmpegAvailable: boolean | null = null;

/**
 * Checks whether the 'ffmpeg' executable is installed and runnable on the system.
 */
export function checkFfmpegAvailable(): boolean {
  if (cachedFfmpegAvailable !== null) {
    return cachedFfmpegAvailable;
  }
  try {
    const result = spawnSync("ffmpeg", ["-version"], {
      stdio: "ignore",
      timeout: 3000,
    });
    cachedFfmpegAvailable = result.status === 0;
  } catch {
    cachedFfmpegAvailable = false;
  }
  return cachedFfmpegAvailable;
}

export interface RemuxSession {
  ticketId: string;
  tsUrl: string;
  tempDir: string;
  m3u8Path: string;
  process: ChildProcess | null;
  createdAt: number;
  lastAccessedAt: number;
  isReady: boolean;
  error: string | null;
}

const activeSessions = new Map<string, RemuxSession>();

// Cleanup stale remux sessions after 90 seconds of inactivity
setInterval(() => {
  const now = Date.now();
  for (const [ticketId, session] of activeSessions.entries()) {
    if (now - session.lastAccessedAt > 90000) {
      stopRemuxSession(ticketId);
    }
  }
}, 30000).unref();

export function stopRemuxSession(ticketId: string) {
  const session = activeSessions.get(ticketId);
  if (!session) return;

  if (session.process && !session.process.killed) {
    try {
      session.process.kill("SIGTERM");
    } catch {
      // ignore
    }
  }

  // Remove temporary directory
  try {
    if (fs.existsSync(session.tempDir)) {
      fs.rmSync(session.tempDir, { recursive: true, force: true });
    }
  } catch {
    // ignore
  }

  activeSessions.delete(ticketId);
}

/**
 * Starts or retrieves an active live HLS remux session using FFmpeg.
 * Converts an upstream MPEG-TS live stream into HLS without re-encoding (-c copy).
 */
export async function getOrStartLiveRemux(
  ticketId: string,
  tsUrl: string
): Promise<{ m3u8Path: string; session: RemuxSession }> {
  if (!checkFfmpegAvailable()) {
    throw new Error(
      "O canal transmite exclusivamente em MPEG-TS (.ts) sem HLS (.m3u8). O servidor precisa do FFmpeg para remux de fluxo ao vivo. Configure o FFmpeg no ambiente do Render."
    );
  }

  const existing = activeSessions.get(ticketId);
  if (existing) {
    existing.lastAccessedAt = Date.now();
    if (existing.error) {
      throw new Error(`Falha no remux de mídia: ${existing.error}`);
    }
    // Wait until m3u8 exists
    await waitForM3u8(existing.m3u8Path, 8000);
    return { m3u8Path: existing.m3u8Path, session: existing };
  }

  const tempDir = path.join(os.tmpdir(), `nc_remux_${ticketId}`);
  fs.mkdirSync(tempDir, { recursive: true });
  const m3u8Path = path.join(tempDir, "live.m3u8");

  const session: RemuxSession = {
    ticketId,
    tsUrl,
    tempDir,
    m3u8Path,
    process: null,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    isReady: false,
    error: null,
  };

  activeSessions.set(ticketId, session);

  // Spawn FFmpeg:
  // -re: read input at native frame rate
  // -i <tsUrl>: input TS stream
  // -c copy: packet copy without CPU-heavy re-encoding
  // -f hls: generate HLS playlist
  // -hls_time 2: 2-second segments for low-latency live
  // -hls_list_size 5: keep 5 segments in playlist
  // -hls_flags delete_segments+split_by_time
  const ffmpegArgs = [
    "-hide_banner",
    "-loglevel", "error",
    "-re",
    "-i", tsUrl,
    "-c", "copy",
    "-f", "hls",
    "-hls_time", "2",
    "-hls_list_size", "5",
    "-hls_flags", "delete_segments+split_by_time",
    "-hls_segment_filename", path.join(tempDir, "seg_%03d.ts"),
    m3u8Path,
  ];

  const child = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["ignore", "ignore", "pipe"],
  });

  session.process = child;

  let stderrOutput = "";
  child.stderr?.on("data", (chunk) => {
    stderrOutput += chunk.toString();
  });

  child.on("error", (err) => {
    session.error = err.message;
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      session.error = `FFmpeg finalizou com código ${code}: ${stderrOutput.slice(0, 200)}`;
    }
  });

  // Wait for the first m3u8 file to be written
  try {
    await waitForM3u8(m3u8Path, 8000);
    session.isReady = true;
    return { m3u8Path, session };
  } catch (err: any) {
    stopRemuxSession(ticketId);
    throw new Error(session.error || err.message || "Tempo limite ao gerar lista HLS com FFmpeg.");
  }
}

function waitForM3u8(filePath: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          // Ensure it has at least one segment line
          if (content.includes(".ts") && content.includes("#EXTINF")) {
            clearInterval(interval);
            resolve();
            return;
          }
        } catch {
          // Retry
        }
      }

      if (Date.now() - startTime > timeoutMs) {
        clearInterval(interval);
        reject(new Error("Tempo esgotado aguardando geração dos segmentos HLS."));
      }
    }, 250);
  });
}

export function getRemuxSession(ticketId: string): RemuxSession | undefined {
  return activeSessions.get(ticketId);
}
