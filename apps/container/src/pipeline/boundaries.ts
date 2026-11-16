import type { Candidate, Envelope, Word } from "../lib/types";
import { FRAME_MS } from "../lib/types";
import { bare, endsSentence } from "./text";

/**
 * §6.5 boundary snapping — pure, no AI, and where clip quality comes from.
 *
 * in  ← best word start within ±3 s: sentence start + pause before + speaker
 *       turn, minus a penalty for moving later (that eats the hook).
 * out ← best word end within ±3 s: sentence end + pause after + falling
 *       energy, minus a penalty for ending on a conjunction/filler.
 * Hard rules: never inside a word; 8 s ≤ duration ≤ 180 s (FR-7.4).
 */
const WINDOW = 3000;
const TRAILING = new Set(["and", "but", "so", "or", "because", "uh", "um", "like", "the", "a", "an", "to", "of", "with"]);

function energyAt(env: Envelope, t0: number, t1: number): number {
  const a = Math.max(0, Math.floor(t0 / FRAME_MS)), b = Math.min(env.length, Math.ceil(t1 / FRAME_MS));
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) s += env[i];
  return s / (b - a);
}

export function snapIn(words: Word[], i: number): number {
  const target = words[i].t0;
  let best = i, bestScore = -Infinity;
  for (let k = i; k >= 0 && words[k].t0 >= target - WINDOW; k--) consider(k);
  for (let k = i + 1; k < words.length && words[k].t0 <= target + WINDOW; k++) consider(k);
  function consider(k: number) {
    const prev = words[k - 1];
    const gap = prev ? words[k].t0 - prev.t1 : 2000;
    let s = 0;
    if (!prev || endsSentence(prev.w)) s += 1;
    s += Math.min(gap, 1000) / 1000 * 0.6;
    if (prev && prev.speaker !== words[k].speaker) s += 0.3;
    if (words[k].t0 > target) s -= (words[k].t0 - target) / 1000 * 0.5; // hook-clip penalty
    if (["uh", "um"].includes(bare(words[k].w))) s -= 0.8;
    s -= (1 - words[k].conf) * 0.3; // low ASR confidence → less trustworthy edge (R-1)
    if (s > bestScore) { bestScore = s; best = k; }
  }
  return best;
}

export function snapOut(words: Word[], env: Envelope, i: number): number {
  const target = words[i].t1;
  let best = i, bestScore = -Infinity;
  for (let k = i; k >= 0 && words[k].t1 >= target - WINDOW; k--) consider(k);
  for (let k = i + 1; k < words.length && words[k].t1 <= target + WINDOW; k++) consider(k);
  function consider(k: number) {
    const next = words[k + 1];
    const gap = next ? next.t0 - words[k].t1 : 2000;
    let s = 0;
    if (endsSentence(words[k].w)) s += 1;
    s += Math.min(gap, 1000) / 1000 * 0.6;
    const tail = energyAt(env, words[k].t1 - 300, words[k].t1);
    const body = energyAt(env, words[k].t1 - 2000, words[k].t1 - 300);
    if (body > 0 && tail < body * 0.85) s += 0.2; // falling energy ~ falling pitch
    if (TRAILING.has(bare(words[k].w))) s -= 1;
    if (s > bestScore) { bestScore = s; best = k; }
  }
  return best;
}

export function snapBoundaries(cands: Candidate[], words: Word[], env: Envelope): Candidate[] {
  return cands.map((c) => {
    let i0 = snapIn(words, c.i0);
    let i1 = snapOut(words, env, c.i1);
    if (i1 <= i0) { i0 = c.i0; i1 = c.i1; }
    // Lead-in / tail padding that stays inside the surrounding silence.
    const gapBefore = i0 > 0 ? words[i0].t0 - words[i0 - 1].t1 : 400;
    const gapAfter = i1 + 1 < words.length ? words[i1 + 1].t0 - words[i1].t1 : 600;
    let tIn = Math.max(0, words[i0].t0 - Math.min(150, Math.max(0, gapBefore / 2)));
    let tOut = words[i1].t1 + Math.min(250, Math.max(0, gapAfter / 2));
    // Duration bounds; if snapping broke them, fall back to the unsnapped window.
    if (tOut - tIn < 8000 || tOut - tIn > 180_000) {
      i0 = c.i0; i1 = c.i1; tIn = words[i0].t0; tOut = words[i1].t1;
    }
    return { ...c, i0, i1, t_in_ms: Math.round(tIn), t_out_ms: Math.round(tOut) };
  });
}
