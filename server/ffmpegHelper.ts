import { spawn, spawnSync, ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";

let cachedFfmpegAvailable: boolean | null = null;
let cachedFfprobeAvailable: boolean | null = null;

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

/**
 * Checks whether the 'ffprobe' executable is installed and runnable on the system.
 */
export function checkFfprobeAvailable(): boolean {
  if (cachedFfprobeAvailable !== null) {
    return cachedFfprobeAvailable;
  }
  try {
    const result = spawnSync("ffprobe", ["-version"], {
      stdio: "ignore",
      timeout: 3000,
    });
    cachedFfprobeAvailable = result.status === 0;
  } catch {
    cachedFfprobeAvailable = false;
  }
  return cachedFfprobeAvailable;
}

export interface MediaProbeInfo {
  duration?: number;
  formatName?: string;
  size?: number;
  videoCodec?: string;
  audioCodec?: string;
  isMaintenanceVideo?: boolean;
  maintenanceReason?: string;
  raw?: any;
}

/**
 * Probes a media stream or file via ffprobe to inspect codecs, duration, and container format.
 */
export async function probeMediaStream(mediaUrl: string, timeoutMs: number = 8000): Promise<MediaProbeInfo> {
  if (!checkFfprobeAvailable()) {
    return {};
  }

  return new Promise((resolve) => {
    const args = [
      "-v", "error",
      "-show_entries", "format=duration,size,format_name,tags:stream=index,codec_name,codec_type,tags",
      "-of", "json",
      mediaUrl,
    ];

    let stdout = "";
    let stderr = "";
    const child = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve({});
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || !stdout.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        const format = parsed.format || {};
        const streams = parsed.streams || [];
        const videoStream = streams.find((s: any) => s.codec_type === "video");
        const audioStream = streams.find((s: any) => s.codec_type === "audio");

        const duration = format.duration ? parseFloat(format.duration) : undefined;
        const size = format.size ? parseInt(format.size, 10) : undefined;
        const videoCodec = videoStream?.codec_name;
        const audioCodec = audioStream?.codec_name;

        // Check if metadata or duration flags maintenance video
        let isMaintenanceVideo = false;
        let maintenanceReason: string | undefined;

        if (duration !== undefined && duration > 0 && duration < 40) {
          isMaintenanceVideo = true;
          maintenanceReason = `Duração muito curta (${Math.round(duration)}s) detectada para filme ou episódio de VOD.`;
        }

        const tags = { ...(format.tags || {}), ...(videoStream?.tags || {}) };
        const tagText = JSON.stringify(tags).toLowerCase();
        if (tagText.includes("manuten") || tagText.includes("maintenance") || tagText.includes("aviso")) {
          isMaintenanceVideo = true;
          maintenanceReason = "Tags do fluxo contêm indicação de manutenção do provedor.";
        }

        resolve({
          duration,
          formatName: format.format_name,
          size,
          videoCodec,
          audioCodec,
          isMaintenanceVideo,
          maintenanceReason,
          raw: parsed,
        });
      } catch {
        resolve({});
      }
    });

    child.on("error", () => {
      clearTimeout(timer);
      resolve({});
    });
  });
}

export interface VodRemuxResult {
  stream: Readable;
  child: ChildProcess;
  stop: () => void;
}

export interface VodRemuxOptions {
  inputUrl: string;
  startSeconds?: number;
  videoCodec?: string;
  audioCodec?: string;
}

/**
 * Starts on-the-fly VOD remuxing/transcoding for web browsers.
 * - Video: copies directly without re-encoding (-c:v copy) when H.264/AVC; transcodes with ultrafast preset if unsupported.
 * - Audio: converts to AAC (-c:a aac -b:a 192k) so that AC3, DTS, EAC3 play smoothly in all browsers.
 * - Container: fragmented MP4 (-movflags frag_keyframe+empty_moov+default_base_moof) for instant streaming.
 * - Seeking: fast input seeking with -ss <seconds> before -i preserves forward/backward scrub.
 */
export function startVodRemuxStream(options: VodRemuxOptions): VodRemuxResult {
  if (!checkFfmpegAvailable()) {
    throw new Error(
      "O servidor precisa do FFmpeg para remux e conversão de áudio/vídeo VOD. Configure o FFmpeg no ambiente."
    );
  }

  const { inputUrl, startSeconds = 0, videoCodec } = options;

  // Most browsers play h264 natively in mp4 container.
  // If video is already h264, copy video stream directly (almost 0% CPU!).
  const canCopyVideo = !videoCodec || videoCodec === "h264" || videoCodec === "avc1";

  const ffmpegArgs: string[] = [
    "-hide_banner",
    "-loglevel", "error",
  ];

  if (startSeconds > 0) {
    // Fast seek before input
    ffmpegArgs.push("-ss", String(startSeconds));
  }

  ffmpegArgs.push(
    "-i", inputUrl,
  );

  if (canCopyVideo) {
    ffmpegArgs.push("-c:v", "copy");
  } else {
    ffmpegArgs.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", "23");
  }

  // Ensure universal audio compatibility in all browsers (AC3/DTS/EAC3 -> AAC)
  ffmpegArgs.push(
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    "-f", "mp4",
    "pipe:1"
  );

  const child = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stop = () => {
    if (!child.killed) {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
  };

  child.stderr?.on("data", (chunk) => {
    // Collect error log if needed
    const msg = chunk.toString();
    if (msg.includes("Error") || msg.includes("fatal")) {
      console.warn(`[FFmpeg VOD Remux] ${msg.slice(0, 200)}`);
    }
  });

  child.on("error", (err) => {
    console.error(`[FFmpeg VOD Remux] Process error:`, err.message);
  });

  return {
    stream: child.stdout as Readable,
    child,
    stop,
  };
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
