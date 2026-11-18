import type { Candidate, Envelope, Word } from "../lib/types";
import { FRAME_MS } from "../lib/types";
import { bare, endsSentence, textOf } from "./text";

/**
 * §6.5 boundary snapping — pure, no AI, and where clip quality comes from.
 *
 * in  ← best word start within ±3 s: sentence start + pause before + speaker
 *       turn, minus a penalty for moving later (that eats the hook).
 * out ← best word end within ±3 s: sentence end + pause after + falling
 *       energy, minus a penalty for ending on a conjunction/filler.
 * Hard rules: never inside a word; never open on a filler/conjunction
 * ("But…", "So…", "Um…"); 15 s ≤ duration ≤ 180 s — a shorter moment is
 * extended by whole sentences rather than shipped as a context-free one-liner.
 */
const WINDOW = 3000;
const TRAILING = new Set(["and", "but", "so", "or", "because", "uh", "um", "like", "the", "a", "an", "to", "of", "with"]);

/** Shortest clip we ship. Under ~15 s a moment rarely carries its own context. */
export const MIN_CLIP_MS = 15_000;
const MAX_CLIP_MS = 180_000;
/** Extending a short moment stops here, so a one-liner doesn't become a ramble. */
const EXTEND_CAP_MS = 35_000;

/** Words a clip must not open on: it starts mid-thought or on filler. */
const OPENERS = new Set(["and", "but", "so", "because", "which", "or", "also", "then", "plus", "um", "uh", "er", "erm",
  "like", "anyway", "anyways", "yeah", "yes", "right", "okay", "ok", "well", "look", "listen", "see", "now"]);
const OPENER_PAIRS = [["i", "mean"], ["you", "know"], ["i", "guess"], ["kind", "of"], ["sort", "of"]];

function openerLength(words: Word[], i: number): number {
  const a = bare(words[i]?.w ?? ""), b = bare(words[i + 1]?.w ?? "");
  if (OPENER_PAIRS.some(([x, y]) => a === x && b === y)) return 2;
  return OPENERS.has(a) ? 1 : 0;
}

/** Moves the start past leading "But / So / Um / I mean…", keeping ≥2 words. */
export function skipOpeners(words: Word[], i0: number, i1: number): number {
  let i = i0;
  for (let n = openerLength(words, i); n && i + n < i1 - 1; n = openerLength(words, i)) i += n;
  return i;
}

/**
 * Grows a too-short window to MIN_CLIP_MS by whole sentences: first the next
 * sentence (usually the payoff or the reaction), then the previous one (the
 * setup) — never past EXTEND_CAP_MS.
 */
export function extendToMin(words: Word[], i0: number, i1: number): [number, number] {
  const dur = (a: number, b: number) => words[b].t1 - words[a].t0;
  let guard = 0;
  while (dur(i0, i1) < MIN_CLIP_MS && guard++ < 12) {
    let grew = false;
    if (i1 + 1 < words.length) {
      let e = i1 + 1;
      while (e + 1 < words.length && !endsSentence(words[e].w) && e - i1 < 60) e++;
      // Only a REAL sentence end (or a pause) — not "60 words of run-on speech".
      const natural = endsSentence(words[e].w) || e + 1 >= words.length || words[e + 1].t0 - words[e].t1 >= 400;
      if (natural && dur(i0, e) <= EXTEND_CAP_MS) { i1 = e; grew = true; }
    }
    if (dur(i0, i1) >= MIN_CLIP_MS) break;
    if (i0 > 0) {
      let s = i0 - 1;
      while (s > 0 && !endsSentence(words[s - 1].w) && i0 - s < 60) s--;
      const natural = s === 0 || endsSentence(words[s - 1].w) || words[s].t0 - words[s - 1].t1 >= 400;
      if (natural && dur(s, i1) <= EXTEND_CAP_MS) { i0 = s; grew = true; }
    }
    if (!grew) break;
  }
  if (dur(i0, i1) >= MIN_CLIP_MS) return [i0, i1];

  // Whole sentences didn't fit — common on streams, where speech runs on
  // without punctuation, and at the edge of a long stream's hot zone. Grow
  // word by word instead, to the first natural PAUSE that reaches the
  // minimum: forward first (the reaction), then back (the setup). Never
  // across a silence over 3 s (a zone edge / a different moment).
  const PAUSE = 250, BREAK = 3000;
  for (let e = i1 + 1; e < words.length && words[e].t0 - words[e - 1].t1 < BREAK && dur(i0, e) <= EXTEND_CAP_MS; e++) {
    const pauseAfter = e + 1 < words.length ? words[e + 1].t0 - words[e].t1 : PAUSE;
    if (dur(i0, e) >= MIN_CLIP_MS && (pauseAfter >= PAUSE || endsSentence(words[e].w))) { i1 = e; break; }
    if (e + 1 >= words.length || dur(i0, e + 1) > EXTEND_CAP_MS || words[e + 1].t0 - words[e].t1 >= BREAK) { i1 = e; break; }
  }
  if (dur(i0, i1) >= MIN_CLIP_MS) return [i0, i1];
  for (let s = i0 - 1; s >= 0 && words[s + 1].t0 - words[s].t1 < BREAK && dur(s, i1) <= EXTEND_CAP_MS; s--) {
    const pauseBefore = s > 0 ? words[s].t0 - words[s - 1].t1 : PAUSE;
    if (dur(s, i1) >= MIN_CLIP_MS && (pauseBefore >= PAUSE || (s > 0 && endsSentence(words[s - 1].w)))) { i0 = s; break; }
    i0 = s;
  }
  return [i0, i1];
}

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
    if (openerLength(words, k)) s -= 1.2; // "But…", "So…", "Um…" — starts mid-thought
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
    i0 = skipOpeners(words, i0, i1);
    [i0, i1] = extendToMin(words, i0, i1);
    i0 = skipOpeners(words, i0, i1); // a sentence added in front may itself open on "So…"
    // Lead-in / tail padding that stays inside the surrounding silence.
    const pad = (a: number, b: number) => {
      const gapBefore = a > 0 ? words[a].t0 - words[a - 1].t1 : 400;
      const gapAfter = b + 1 < words.length ? words[b + 1].t0 - words[b].t1 : 600;
      return [Math.max(0, words[a].t0 - Math.min(150, Math.max(0, gapBefore / 2))), words[b].t1 + Math.min(250, Math.max(0, gapAfter / 2))];
    };
    let [tIn, tOut] = pad(i0, i1);
    // Duration bounds; if snapping broke them, rebuild from the original window.
    if (tOut - tIn < MIN_CLIP_MS || tOut - tIn > MAX_CLIP_MS) {
      [i0, i1] = extendToMin(words, skipOpeners(words, c.i0, c.i1), c.i1);
      [tIn, tOut] = pad(i0, i1);
    }
    // Opening mid-thought is worse than being a little short: if the only way
    // to reach 15 s was to include a "But look, I mean…", drop it anyway.
    const clean = skipOpeners(words, i0, i1);
    if (clean !== i0) { i0 = clean; [tIn, tOut] = pad(i0, i1); }
    const text = i0 === c.i0 && i1 === c.i1 ? c.text : textOf(words, i0, i1);
    return { ...c, i0, i1, text, t_in_ms: Math.round(tIn), t_out_ms: Math.round(tOut) };
  });
}
