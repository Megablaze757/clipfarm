import type { Sentence, Word } from "../lib/types";

export const endsSentence = (w: string) => /[.?!…]["')\]]*$/.test(w);
export const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/** Splits words into sentences on terminal punctuation, or on a long pause when punctuation is missing. */
export function sentences(words: Word[], pauseBreakMs = 900): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    const gap = i + 1 < words.length ? words[i + 1].t0 - words[i].t1 : Infinity;
    const turn = i + 1 < words.length && words[i + 1].speaker !== words[i].speaker;
    if (endsSentence(words[i].w) || gap >= pauseBreakMs || (turn && gap >= 300) || i === words.length - 1) {
      out.push({ i0: start, i1: i, t0: words[start].t0, t1: words[i].t1 });
      start = i + 1;
    }
  }
  return out;
}

/** FR-4.1 pause map: gaps ≥ 200 ms, keyed by the index of the word before the gap. */
export function pauseMap(words: Word[], minMs = 200): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i + 1 < words.length; i++) {
    const gap = words[i + 1].t0 - words[i].t1;
    if (gap >= minMs) m.set(i, gap);
  }
  return m;
}

export const textOf = (words: Word[], i0: number, i1: number) =>
  words.slice(i0, i1 + 1).map((w) => w.w).join(" ").replace(/\s+([,.?!;:])/g, "$1");

/** Fraction of [t0, t1] covered by speech. */
export function speechRatio(words: Word[], i0: number, i1: number): number {
  const span = words[i1].t1 - words[i0].t0;
  if (span <= 0) return 0;
  let spoken = 0;
  for (let i = i0; i <= i1; i++) spoken += words[i].t1 - words[i].t0;
  return Math.min(1, spoken / span);
}

export function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\W+/).filter((t) => t.length > 3));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
