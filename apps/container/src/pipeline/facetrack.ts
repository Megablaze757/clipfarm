import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ffmpeg, run } from "../lib/proc";
import type { Word } from "../lib/types";

/**
 * AUTOMATIC REFRAMING on the runner — every picked clip comes out framed on
 * the speaker, not centre-cropped, without anyone clicking anything.
 *
 * Same plan as the editor's auto-reframe (apps/web/src/lib/reframe.ts), so a
 * clip looks the same either way:
 *   1. a frame every 0.5 s → faces (OpenCV YuNet, scripts/face_detect.py);
 *   2. per speaker turn, aim at the biggest face;
 *   3. EMA across turns; pan only in the pause at a turn change;
 *   4. barely moving → one static crop; no faces → centre / letterbox.
 * Plus: TWO PEOPLE side by side for most of the clip → a two-speaker layout
 * (stacked top/bottom), offered in the editor and used by "two".
 *
 * Needs Python + opencv-python-headless + the YuNet model (the workflow
 * installs them for processing jobs). Missing any → clips keep the centre crop.
 */
export interface Keyframe { t_ms: number; cx: number }
export interface FaceSample { t: number; faces: { cx: number; cy: number; w: number; h: number }[] }
export interface Reframe { mode: "manual" | "center" | "fit"; keyframes: Keyframe[]; two: { a: number; b: number } | null; faces: number; samples: number }

const round = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 1000) / 1000;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** Speaker turns inside [inMs, outMs] from the transcript's diarization labels. */
export function turns(words: Word[], inMs: number, outMs: number): { t0: number; t1: number; speaker: string }[] {
  const out: { t0: number; t1: number; speaker: string }[] = [];
  for (const w of words) {
    if (w.t1 <= inMs || w.t0 >= outMs) continue;
    const last = out[out.length - 1];
    if (last && last.speaker === w.speaker) last.t1 = w.t1;
    else out.push({ t0: Math.max(inMs, w.t0), t1: w.t1, speaker: w.speaker });
  }
  if (!out.length) out.push({ t0: inMs, t1: outMs, speaker: "S1" });
  out[out.length - 1].t1 = outMs;
  return out;
}

/** Pure: face samples → a reframe plan (testable without video). */
export function planReframe(samples: FaceSample[], words: Word[], inMs: number, outMs: number, srcAspect: number, targetAspect: number): Reframe {
  const found = samples.map((s) => {
    const big = [...s.faces].sort((a, b) => b.w * b.h - a.w * a.h)[0];
    return { t: s.t, cx: big ? big.cx : null };
  });
  const hits = found.filter((s) => s.cx != null) as { t: number; cx: number }[];

  // Two people, side by side, similar size, for most of the clip.
  let two: Reframe["two"] = null;
  const pairs = samples.filter((s) => s.faces.length >= 2).map((s) => {
    const [p, q] = [...s.faces].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 2);
    const [l, r] = p.cx < q.cx ? [p, q] : [q, p];
    return { l: l.cx, r: r.cx, sep: r.cx - l.cx, ratio: Math.min(p.w * p.h, q.w * q.h) / Math.max(p.w * p.h, q.w * q.h) };
  }).filter((x) => x.sep > 0.22 && x.ratio > 0.35);
  if (samples.length && pairs.length >= samples.length * 0.55 && srcAspect > 1.2) {
    two = { a: round(median(pairs.map((x) => x.l))), b: round(median(pairs.map((x) => x.r))) };
  }

  const base = { two, faces: hits.length, samples: samples.length };
  if (hits.length < samples.length * 0.4) {
    return { mode: srcAspect > 1.5 && targetAspect < 1 ? "fit" : "center", keyframes: [], ...base };
  }
  const perTurn = turns(words, inMs, outMs).map((turn) => {
    const xs = hits.filter((s) => s.t >= turn.t0 && s.t < turn.t1).map((s) => s.cx);
    return { ...turn, cx: xs.length ? median(xs) : null };
  });
  // Start ON the first speaker (not blended toward the clip's average), then EMA.
  let prev = perTurn.find((t) => t.cx != null)?.cx ?? median(hits.map((s) => s.cx));
  const smoothed = perTurn.map((t) => { prev = prev + 0.7 * ((t.cx ?? prev) - prev); return { ...t, cx: prev }; });
  const xs = smoothed.map((t) => t.cx);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  if (sd < 0.03 || smoothed.length === 1) return { mode: "manual", keyframes: [{ t_ms: 0, cx: round(mean) }], ...base };
  const keyframes: Keyframe[] = [];
  smoothed.forEach((t, i) => {
    const start = Math.max(0, t.t0 - inMs);
    if (i === 0) keyframes.push({ t_ms: 0, cx: round(t.cx) });
    else {
      keyframes.push({ t_ms: Math.max(0, start - 200), cx: round(smoothed[i - 1].cx) });
      keyframes.push({ t_ms: start + 200, cx: round(t.cx) });
    }
  });
  return { mode: "manual", keyframes: keyframes.slice(0, 60), ...base };
}

export function faceTrackingAvailable(): boolean {
  return !!process.env.WHISPER_PYTHON && !!process.env.FACE_MODEL && existsSync(process.env.FACE_MODEL);
}

/**
 * Extracts 2 fps frames for every clip, detects faces in ONE Python run
 * (the model loads once), and returns a plan per clip. `media(i)` says where
 * clip i's video is and what time that file starts at in source time.
 */
export async function trackClips(
  clips: { t_in_ms: number; t_out_ms: number }[],
  media: (i: number) => { path: string; offsetMs: number; inputArgs?: string[] } | null,
  words: Word[], srcAspect: number, dir: string, targetAspect = 9 / 16,
): Promise<(Reframe | null)[]> {
  if (!faceTrackingAvailable() || !clips.length) return clips.map(() => null);
  const framesDir = join(dir, "faces");
  await mkdir(framesDir, { recursive: true });
  const list: { i: number; path: string; clip: number; t: number }[] = [];
  for (let c = 0; c < clips.length; c++) {
    const m = media(c);
    if (!m) continue;
    const { t_in_ms: a, t_out_ms: b } = clips[c];
    try {
      await ffmpeg(["-ss", ((a - m.offsetMs) / 1000).toFixed(2), ...(m.inputArgs ?? []), "-i", m.path, "-t", ((b - a) / 1000).toFixed(2),
        "-vf", "fps=2,scale=320:-2", "-q:v", "6", join(framesDir, `c${c}_%04d.jpg`)], 5 * 60 * 1000);
      for (let k = 1; k <= Math.ceil((b - a) / 500) + 1; k++) {
        const path = join(framesDir, `c${c}_${String(k).padStart(4, "0")}.jpg`);
        if (existsSync(path)) list.push({ i: list.length, path, clip: c, t: a + (k - 1) * 500 });
      }
    } catch (e) {
      console.warn(`face frames ${c}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  if (!list.length) return clips.map(() => null);
  const listing = join(framesDir, "frames.json");
  await writeFile(listing, JSON.stringify(list.map(({ i, path }) => ({ i, path }))));
  const script = join(__dirname, "..", "..", "scripts", "face_detect.py");
  let out = "";
  try {
    ({ stdout: out } = await run(process.env.WHISPER_PYTHON!, [script, process.env.FACE_MODEL!, listing], { timeoutMs: 15 * 60 * 1000 }));
  } catch (e) {
    console.warn(`face detection unavailable: ${(e as Error).message.slice(0, 300)}`);
    return clips.map(() => null);
  }
  const byFrame = new Map<number, FaceSample["faces"]>();
  for (const line of out.split("\n")) {
    try {
      const j = JSON.parse(line) as { i: number; faces: number[][] };
      byFrame.set(j.i, j.faces.map(([cx, cy, w, h]) => ({ cx, cy, w, h })));
    } catch { /* non-JSON line */ }
  }
  return clips.map((c, ci) => {
    const samples = list.filter((f) => f.clip === ci).map((f) => ({ t: f.t, faces: byFrame.get(f.i) ?? [] }));
    return samples.length ? planReframe(samples, words, c.t_in_ms, c.t_out_ms, srcAspect, targetAspect) : null;
  });
}
