import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { ffmpeg, run, StageError } from "../lib/proc";
import type { Envelope, Transcript } from "../lib/types";
import { FRAME_MS } from "../lib/types";
import { parseChat, type ChatMessage, type ChatSignal } from "./chat";
import { classifyYtDlpError } from "./ingest";
import { energyEnvelope } from "./transcode";

/**
 * LONG-STREAM MODE — for links over LONG_MS (a 10-hour stream, a 24-hour
 * marathon). Downloading and transcribing everything would take hours, and
 * most of a long stream isn't clip material anyway. So:
 *
 *   1. download AUDIO ONLY (≈70 MB/hour) — and the Twitch chat — in parallel;
 *   2. find the HOT ZONES: the minutes around the biggest chat explosions
 *      (or, with no chat, the loudest reaction spikes in the audio);
 *   3. transcribe only those zones (stitched into one file, then mapped back
 *      to stream time) — the normal engine then scores them;
 *   4. download VIDEO only for the clips it picks (±20 s), and align each
 *      section to the stream to the frame by matching its audio.
 */
export const LONG_MS = 2 * 60 * 60 * 1000;
const YTDLP = () => process.env.YTDLP_BIN || "yt-dlp";

export interface Zone { t0: number; t1: number } // stream time, ms

export async function probeLink(url: string): Promise<{ durationMs: number; title?: string } | null> {
  try {
    const { stdout } = await run(YTDLP(), ["--no-playlist", "--skip-download", "--print", "duration", "--print", "title", url], { timeoutMs: 120_000 });
    const [d, title] = stdout.trim().split("\n");
    const s = Number(d);
    return Number.isFinite(s) && s > 0 ? { durationMs: Math.round(s * 1000), title: title?.slice(0, 200) } : null;
  } catch (e) {
    throw classifyYtDlpError(String((e as Error).message));
  }
}

export async function downloadAudioOnly(url: string, dir: string): Promise<string> {
  try {
    await run(YTDLP(), [
      "--no-playlist", "--no-progress",
      // Twitch exposes an "Audio_Only" rendition; elsewhere the best audio, else the smallest video.
      "-f", "Audio_Only/audio_only/ba/worst",
      "--concurrent-fragments", "16", "--retries", "5", "--fragment-retries", "10",
      "-o", join(dir, "longaudio.%(ext)s"), url,
    ], { timeoutMs: 90 * 60 * 1000 });
  } catch (e) {
    throw classifyYtDlpError(String((e as Error).message));
  }
  const f = (await readdir(dir)).find((x) => x.startsWith("longaudio.") && !x.endsWith(".part"));
  if (!f) throw new StageError("E_INGEST_CORRUPT", "The stream's audio didn't download.");
  return join(dir, f);
}

export function twitchVodId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)twitch\.tv$/i.test(u.hostname)) return null;
    return u.pathname.match(/\/videos\/(\d+)/)?.[1] ?? null;
  } catch { return null; }
}

/**
 * The VOD's chat replay via TwitchDownloaderCLI (installed by the workflow),
 * as relative-timestamped text — ~60 bytes a message, so even a marathon's
 * millions of messages stay small. Returns null if unavailable or too slow.
 */
export async function downloadTwitchChat(vodId: string, dir: string, timeoutMs = 35 * 60 * 1000): Promise<string | null> {
  const bin = process.env.TWITCH_CHAT_BIN;
  if (!bin) return null;
  const out = join(dir, "chat.txt");
  try {
    await run(bin, ["chatdownload", "--id", vodId, "-o", out, "--timestamp-format", "Relative", "--threads", "16", "--collision", "Overwrite"], { timeoutMs });
    return (await stat(out)).size > 0 ? out : null;
  } catch (e) {
    console.warn(`chat download failed: ${String((e as Error).message).slice(-300)}`);
    return null;
  }
}

/** Streams a (possibly huge) chat log; JSON logs fall back to a whole-file parse. */
export async function parseChatFile(path: string): Promise<ChatMessage[]> {
  const first = await new Promise<string>((res) => {
    const s = createReadStream(path, { start: 0, end: 64, encoding: "utf8" });
    let b = ""; s.on("data", (c) => { b += c; }); s.on("end", () => res(b)); s.on("error", () => res(""));
  });
  if (/^\s*[[{]/.test(first.replace(/^﻿/, "")) && !/^\s*\{[^\n]*\}\s*\n/.test(first)) {
    const { readFile } = await import("node:fs/promises");
    return parseChat(await readFile(path, "utf8"));
  }
  const out: ChatMessage[] = [];
  let batch: string[] = [];
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    batch.push(line);
    if (batch.length >= 50_000) { out.push(...parseChat(batch.join("\n"))); batch = []; }
  }
  if (batch.length) out.push(...parseChat(batch.join("\n")));
  return out.sort((a, b) => a.t - b.t);
}

function mergeZones(zs: Zone[], durationMs: number): Zone[] {
  const sorted = zs.map((z) => ({ t0: Math.max(0, z.t0), t1: Math.min(durationMs, z.t1) })).filter((z) => z.t1 > z.t0).sort((a, b) => a.t0 - b.t0);
  const out: Zone[] = [];
  for (const z of sorted) {
    const last = out[out.length - 1];
    if (last && z.t0 <= last.t1 + 15_000) last.t1 = Math.max(last.t1, z.t1);
    else out.push({ ...z });
  }
  return out;
}

/** How many zones a stream gets: ~4 an hour, 12–48. */
export const zoneBudget = (durationMs: number) => Math.max(12, Math.min(48, Math.round((durationMs / 3_600_000) * 4)));

/** The minutes leading up to each big chat explosion (the moment, then the reaction). */
export function zonesFromChat(chat: ChatSignal, durationMs: number): Zone[] {
  const top = [...chat.spikes].sort((a, b) => b.z - a.z).slice(0, zoneBudget(durationMs));
  return mergeZones(top.map((s) => ({ t0: s.t - 120_000, t1: s.peak + 45_000 })), durationMs);
}

/**
 * No chat: the loudest REACTIONS — moments where the audio jumps well above
 * its surroundings (yelling, laughing, hype), found on a 1 s grid against a
 * rolling 5-minute baseline.
 */
export function zonesFromEnergy(env: Envelope, durationMs: number): Zone[] {
  const per = Math.round(1000 / FRAME_MS), n = Math.floor(env.length / per);
  if (n < 120) return [{ t0: 0, t1: durationMs }];
  const sec = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < per; k++) s += env[i * per + k]; sec[i] = s / per; }
  // 8 s loudness vs the surrounding 5 minutes.
  const W = 8, B = 300, pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + sec[i];
  const mean = (a: number, b: number) => (pre[Math.min(n, b)] - pre[Math.max(0, a)]) / Math.max(1, Math.min(n, b) - Math.max(0, a));
  const cand: { i: number; v: number }[] = [];
  for (let i = 0; i + W < n; i += 2) {
    const base = mean(i - B / 2, i + B / 2);
    if (base <= 0.005) continue;
    cand.push({ i, v: mean(i, i + W) / base });
  }
  cand.sort((a, b) => b.v - a.v);
  const picked: number[] = [];
  for (const c of cand) {
    if (picked.length >= zoneBudget(durationMs)) break;
    if (picked.some((p) => Math.abs(p - c.i) < 180)) continue;
    picked.push(c.i);
  }
  return mergeZones(picked.map((i) => ({ t0: i * 1000 - 120_000, t1: i * 1000 + 45_000 })), durationMs);
}

/** Stitches the zones of the full-length WAV into one file for transcription. */
export async function buildZoneAudio(fullWav: string, zones: Zone[], out: string): Promise<void> {
  const parts = zones.map((z, i) => `[0:a]atrim=start=${(z.t0 / 1000).toFixed(3)}:end=${(z.t1 / 1000).toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
  const graph = `${parts.join(";")};${zones.map((_, i) => `[a${i}]`).join("")}concat=n=${zones.length}:v=0:a=1[out]`;
  await ffmpeg(["-i", fullWav, "-filter_complex", graph, "-map", "[out]", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out], 30 * 60 * 1000);
}

/** Maps a transcript of the stitched zone audio back to stream time. */
export function remapTranscript(t: Transcript, zones: Zone[]): Transcript {
  const starts: number[] = [];
  let acc = 0;
  for (const z of zones) { starts.push(acc); acc += z.t1 - z.t0; }
  const map = (ms: number) => {
    let k = 0;
    while (k + 1 < starts.length && starts[k + 1] <= ms) k++;
    return Math.min(zones[k].t1, zones[k].t0 + (ms - starts[k]));
  };
  return {
    ...t,
    words: t.words.map((w) => ({ ...w, t0: map(w.t0), t1: Math.max(map(w.t0), map(w.t1)) })),
    segments: t.segments.map((s) => ({ ...s, start: map(s.start), end: Math.max(map(s.start), map(s.end)) })),
  };
}

/** True if the words i0..i1 jump across a gap (i.e. two different zones). */
export function spansGap(words: { t0: number; t1: number }[], i0: number, i1: number, maxGapMs = 15_000): boolean {
  for (let i = i0; i < i1; i++) if (words[i + 1].t0 - words[i].t1 > maxGapMs) return true;
  return false;
}

/** Downloads only [startMs, endMs] of the stream's video. */
export async function downloadSection(url: string, startMs: number, endMs: number, out: string): Promise<void> {
  const t = (ms: number) => (ms / 1000).toFixed(1);
  await run(YTDLP(), [
    "--no-playlist", "--no-progress",
    "-f", "bv*[height<=1080]+ba/b[height<=1080]/best",
    "--download-sections", `*${t(startMs)}-${t(endMs)}`,
    "--merge-output-format", "mp4", "--concurrent-fragments", "8", "--retries", "5",
    "-o", out, url,
  ], { timeoutMs: 20 * 60 * 1000 });
}

/**
 * Where a downloaded section really starts in the stream. Section downloads
 * snap to keyframes/segments, so instead of trusting the request we slide
 * the section's loudness curve over the full stream's, ±12 s around where it
 * should be, and take the best match (100 ms resolution).
 */
export async function alignSection(section: string, sectionMs: number, full: Envelope, expectedStartMs: number): Promise<number> {
  const sec = await energyEnvelope(section, sectionMs);
  const L = Math.min(sec.length, Math.round(40_000 / FRAME_MS));
  if (L < 50) return expectedStartMs;
  let mA = 0; for (let i = 0; i < L; i++) mA += sec[i]; mA /= L;
  let vA = 0; for (let i = 0; i < L; i++) vA += (sec[i] - mA) ** 2;
  if (vA <= 1e-9) return expectedStartMs; // silent (muted) section — nothing to match
  const e0 = Math.round(expectedStartMs / FRAME_MS), R = Math.round(12_000 / FRAME_MS);
  let best = e0, bestC = -Infinity;
  for (let s = Math.max(0, e0 - R); s <= e0 + R && s + L <= full.length; s++) {
    let mB = 0; for (let i = 0; i < L; i++) mB += full[s + i]; mB /= L;
    let cov = 0, vB = 0;
    for (let i = 0; i < L; i++) { const b = full[s + i] - mB; cov += (sec[i] - mA) * b; vB += b * b; }
    const c = vB > 0 ? cov / Math.sqrt(vA * vB) : -1;
    if (c > bestC) { bestC = c; best = s; }
  }
  return bestC > 0.5 ? best * FRAME_MS : expectedStartMs;
}
