import type { Sentence, Word } from "../lib/types";
import { bare, speechRatio } from "./text";

export interface Window {
  i0: number;
  i1: number;
  t0: number;
  t1: number;
}

/** Openers that mean the clip starts mid-thought (FR-5.2). */
const BAD_OPENERS = new Set(["and", "but", "so", "because", "which", "or", "also", "then", "plus", "um", "uh", "like", "anyway", "yeah", "right", "okay", "ok"]);
/** Third-person references that need an antecedent. */
export const PRONOUNS = new Set(["he", "she", "they", "him", "her", "them", "his", "hers", "their", "theirs", "it", "its", "this", "that", "these", "those"]);

export function durationRange(pref: number[] | "auto" | undefined): [number, number][] {
  if (!pref || pref === "auto" || !pref.length) return [[15_000, 90_000]];
  return pref.map((d) => [Math.max(8_000, d * 700), Math.min(180_000, d * 1300)] as [number, number]);
}

/**
 * Why a window can't stand alone, or null if it survives Stage A (§6.3).
 * Cheap rules only — no model is spent on anything rejected here.
 */
export function rejectReason(words: Word[], w: Window): string | null {
  if (speechRatio(words, w.i0, w.i1) < 0.25) return "low_speech";
  const first = bare(words[w.i0].w);
  if (BAD_OPENERS.has(first)) return "mid_thought_opener";
  // A pronoun in the first five words with no proper noun before it.
  for (let i = w.i0; i < Math.min(w.i1, w.i0 + 5); i++) {
    const b = bare(words[i].w);
    if (/^\p{Lu}/u.test(words[i].w) && i > w.i0 && !PRONOUNS.has(b)) break; // named entity introduced first
    if (["he", "she", "they", "him", "her", "them", "his", "their"].includes(b)) return "unresolved_pronoun";
  }
  return null;
}

/**
 * FR-5.1 sliding windows that start on a sentence start and end on a sentence
 * end, so no candidate begins or ends mid-sentence. Deterministic (FR-5.6).
 */
export function generateWindows(words: Word[], sents: Sentence[], pref: number[] | "auto" | undefined, cap: number): Window[] {
  const ranges = durationRange(pref);
  const minD = Math.min(...ranges.map((r) => r[0]));
  const maxD = Math.max(...ranges.map((r) => r[1]));
  const out: Window[] = [];
  for (let s = 0; s < sents.length; s++) {
    for (let e = s; e < sents.length; e++) {
      const d = sents[e].t1 - sents[s].t0;
      if (d > maxD) break;
      if (d < minD) continue;
      if (!ranges.some(([lo, hi]) => d >= lo && d <= hi)) continue;
      const w = { i0: sents[s].i0, i1: sents[e].i1, t0: sents[s].t0, t1: sents[e].t1 };
      if (!rejectReason(words, w)) out.push(w);
    }
  }
  if (out.length <= cap) return out;
  // Keep an even spread across the source rather than the first N.
  const step = out.length / cap;
  return Array.from({ length: cap }, (_, k) => out[Math.floor(k * step)]);
}

/** FR-5.5: 10–20 per source hour, at least 3, unless the plan or user caps it. */
export function targetCount(durationMs: number, planCap: number | null, userMax: number | null): number {
  const byLength = Math.max(3, Math.min(20, Math.round((durationMs / 3_600_000) * 15)));
  return Math.max(1, Math.min(byLength, planCap ?? Infinity, userMax ?? Infinity));
}
