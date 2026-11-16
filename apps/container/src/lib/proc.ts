import { spawn } from "node:child_process";

export class StageError extends Error {
  constructor(public code: string, message: string, public retryable = false) {
    super(message);
  }
}

/**
 * Runs a binary with an argv array — never a shell string, so file names and
 * URLs can't inject commands. Keeps the tail of stderr for error_detail (§12.6).
 */
export function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; onStdout?: (chunk: Buffer) => void } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;
    child.stdout.on("data", (c: Buffer) => {
      if (opts.onStdout) opts.onStdout(c);
      else if (stdout.length < 4_000_000) stdout += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on("error", (e) => { if (timer) clearTimeout(timer); reject(e); });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        const e = new Error(`${cmd} exited ${code ?? signal}: ${stderr.trim().split("\n").slice(-6).join(" | ")}`);
        (e as any).stderr = stderr;
        reject(e);
      }
    });
  });
}

/** FFmpeg with one retry on failure (§12.6). */
export async function ffmpeg(args: string[], timeoutMs = 60 * 60 * 1000): Promise<{ stdout: string; stderr: string }> {
  const full = ["-hide_banner", "-nostdin", "-y", ...args];
  try {
    return await run("ffmpeg", full, { timeoutMs });
  } catch (e) {
    console.warn(`ffmpeg failed once, retrying: ${(e as Error).message.slice(0, 300)}`);
    return run("ffmpeg", full, { timeoutMs });
  }
}

export interface Probe {
  durationMs: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
  fps: number;
  rotation: number;
}

export async function probe(path: string): Promise<Probe> {
  let out: string;
  try {
    ({ stdout: out } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], { timeoutMs: 120_000 }));
  } catch (e) {
    const msg = (e as Error).message;
    if (/drm|encrypt|protected/i.test(msg)) throw new StageError("E_SOURCE_DRM", "This file is DRM-protected and can't be processed.");
    throw new StageError("E_INGEST_CORRUPT", "That file couldn't be read as audio or video.");
  }
  const j = JSON.parse(out) as { format?: { duration?: string }; streams?: any[] };
  const streams = j.streams ?? [];
  if (streams.some((s) => s.tags?.encryption || s.codec_tag_string === "encv" || s.codec_tag_string === "enca")) {
    throw new StageError("E_SOURCE_DRM", "This file is DRM-protected and can't be processed.");
  }
  const v = streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const a = streams.find((s) => s.codec_type === "audio");
  const [num, den] = String(v?.avg_frame_rate ?? "30/1").split("/").map(Number);
  const rotation = Math.abs(Number(v?.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0));
  let width = Number(v?.width) || 0;
  let height = Number(v?.height) || 0;
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  return {
    durationMs: Math.round(Number(j.format?.duration ?? 0) * 1000),
    hasVideo: !!v,
    hasAudio: !!a,
    width,
    height,
    fps: den ? Math.min(60, num / den) || 30 : 30,
    rotation,
  };
}
