import { spawn } from "node:child_process";
import { ffmpeg, type Probe } from "../lib/proc";
import { FRAME_MS, type Envelope } from "../lib/types";

/**
 * FR-2.1 mezzanine: H.264 High, AAC 48 kHz stereo, ≤1080p, 2 s GOP, faststart.
 * Audio-only sources get a waveform video so every later stage can treat
 * everything as video.
 */
/**
 * Already H.264 + AAC, ≤1080p, 8-bit 4:2:0, no rotation? Then re-encoding buys
 * nothing — copy the streams into a fast-start MP4 in seconds instead of
 * spending up to real-time re-encoding (YouTube downloads usually qualify,
 * because ingest asks yt-dlp for H.264 first). Renders still cut accurately:
 * they re-encode from an input seek, which doesn't need a fixed GOP.
 */
export function canStreamCopy(info: Probe): boolean {
  return info.hasVideo && info.vcodec === "h264" && info.acodec === "aac" &&
    info.height <= 1080 && info.width <= 1920 && info.rotation === 0 &&
    (info.pixFmt === "yuv420p" || info.pixFmt === "yuvj420p");
}

export async function makeMezzanine(src: string, out: string, info: Probe, inputArgs: string[] = []): Promise<"copied" | "encoded"> {
  if (canStreamCopy(info)) {
    try {
      await ffmpeg([...inputArgs, "-i", src, "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-movflags", "+faststart", out]);
      return "copied";
    } catch (e) {
      console.warn(`stream copy failed, re-encoding: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  // "veryfast" is ~4-6x quicker than "medium" for ~10-15 % more bytes at the
  // same CRF — the right trade for a working copy that's deleted within a week.
  // Long sources go faster still: on a 4-core runner veryfast measured ~2.4x
  // real time (worst case), so 5 h would take ~2 h; "superfast" roughly halves
  // that for bigger files, keeping long jobs well inside GitHub's 6-hour limit.
  const preset = info.durationMs > 90 * 60_000 ? "superfast" : "veryfast";
  const enc = ["-c:v", "libx264", "-profile:v", "high", "-crf", "21", "-preset", preset, "-g", "60", "-keyint_min", "60",
    "-sc_threshold", "0", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "160k",
    "-movflags", "+faststart"];
  if (info.hasVideo) {
    await ffmpeg([...inputArgs, "-i", src, "-map", "0:v:0", "-map", "0:a:0?",
      "-vf", "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2",
      ...enc, out]);
  } else {
    await ffmpeg([...inputArgs, "-i", src, "-f", "lavfi", "-i", "color=c=0x0f172a:s=1280x720:r=30",
      "-filter_complex", "[0:a]showwaves=s=1280x260:mode=cline:colors=0x818cf8:rate=30[w];[1:v][w]overlay=0:230:shortest=1[v]",
      "-map", "[v]", "-map", "0:a:0", ...enc, out]);
  }
  return "encoded";
}

/** FR-2.2: 16 kHz mono PCM for ASR. */
export async function extractAudio(src: string, out: string, inputArgs: string[] = []): Promise<void> {
  await ffmpeg([...inputArgs, "-i", src, "-vn", "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out]);
}

/** FR-2.3 EBU R128 analysis. */
export async function analyzeLoudness(audio: string): Promise<Record<string, number> | null> {
  try {
    const { stderr } = await ffmpeg(["-i", audio, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"]);
    const m = stderr.slice(stderr.lastIndexOf("{")).match(/\{[\s\S]*\}/);
    if (!m) return null;
    const raw = JSON.parse(m[0]) as Record<string, string>;
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v)]).filter(([, v]) => Number.isFinite(v as number)));
  } catch {
    return null;
  }
}

/**
 * FR-4.3 energy envelope: RMS per 100 ms frame, normalised to 0–1. Streamed
 * from FFmpeg at 8 kHz so a 4-hour source never sits in memory as PCM.
 */
export function energyEnvelope(audio: string, durationMs: number): Promise<Envelope> {
  const sampleRate = 8000;
  const perFrame = (sampleRate * FRAME_MS) / 1000;
  const frames = new Float32Array(Math.ceil(durationMs / FRAME_MS) + 1);
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-nostdin", "-i", audio, "-f", "s16le", "-ac", "1", "-ar", String(sampleRate), "-"], { stdio: ["ignore", "pipe", "ignore"] });
    let idx = 0, acc = 0, n = 0;
    let carry: Buffer | null = null;
    child.stdout.on("data", (chunk: Buffer) => {
      const buf = carry ? Buffer.concat([carry, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      for (let o = 0; o < usable; o += 2) {
        const s = buf.readInt16LE(o) / 32768;
        acc += s * s;
        if (++n === perFrame) {
          if (idx < frames.length) frames[idx] = Math.sqrt(acc / n);
          idx++; acc = 0; n = 0;
        }
      }
      carry = usable < buf.length ? buf.subarray(usable) : null;
    });
    const done = () => {
      let max = 0;
      for (const v of frames) if (v > max) max = v;
      if (max > 0) for (let i = 0; i < frames.length; i++) frames[i] /= max;
      resolve(frames);
    };
    child.on("close", done);
    child.on("error", done);
  });
}

/** FR-2.5 posters. */
export async function poster(src: string, atMs: number, outJpg: string, outWebp?: string, inputArgs: string[] = []): Promise<void> {
  await ffmpeg(["-ss", (atMs / 1000).toFixed(2), ...inputArgs, "-i", src, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", outJpg]);
  if (outWebp) await ffmpeg(["-i", outJpg, "-quality", "80", outWebp]).catch(() => {});
}

/**
 * The editor's video for one clip: [startMs, endMs] (the clip ±60 s) at 360p,
 * the frame uncropped so MediaPipe can find faces. Replaces a whole-source
 * preview — on a 5-hour stream that was ~87 min of encoding; 20 of these are
 * ~50 min of source in total, encoded three at a time.
 */
export async function editPreview(mezzanine: string, startMs: number, endMs: number, out: string): Promise<void> {
  await ffmpeg(["-ss", (startMs / 1000).toFixed(3), "-i", mezzanine, "-t", ((endMs - startMs) / 1000).toFixed(3),
    "-vf", "scale=-2:360", "-c:v", "libx264", "-crf", "30", "-preset", "ultrafast", "-g", "30",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k", "-ac", "1", "-movflags", "+faststart", out], 15 * 60 * 1000);
}

/**
 * Can browsers play this file as-is (with seeking), and FFmpeg cut exports
 * from it directly? Then there's no need for a working copy at all: the
 * original IS the media. That skips the slowest part of processing — the
 * re-encode (up to real time) and the multi-GB re-upload.
 *
 *   MP4/MOV + H.264 + AAC/MP3   → every modern browser
 *   WebM + VP8/VP9/AV1 + Opus/Vorbis → Chrome, Firefox, Edge (and recent Safari)
 * MKV, HEVC, audio-only and anything else gets a working copy as before.
 */
export function browserPlayable(info: Probe, fileName: string): boolean {
  if (!info.hasVideo || info.height > 2160) return false;
  const ext = fileName.toLowerCase().replace(/[?#].*$/, "").split(".").pop() ?? "";
  const fmt = info.format;
  const mp4ish = /mp4|mov/.test(fmt) && ["mp4", "m4v", "mov"].includes(ext);
  const webm = /webm/.test(fmt) && ext === "webm";
  if (mp4ish) return info.vcodec === "h264" && ["aac", "mp3"].includes(info.acodec) && /yuv420p|yuvj420p/.test(info.pixFmt);
  if (webm) return ["vp8", "vp9", "av1"].includes(info.vcodec) && ["opus", "vorbis"].includes(info.acodec);
  return false;
}
