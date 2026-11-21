import { isPowerWord } from "./captions";

/**
 * TIGHTENING + PUNCH-INS — the two edits nearly every viral podcast clip has.
 *
 *   planCuts   long pauses shrink to a natural 0.3 s and standalone "um / uh"
 *              disappear, so the clip moves (never more than 35 % cut);
 *   mapTime    where a moment of the ORIGINAL clip lands after the cuts —
 *              captions and the face-follow camera use it to stay in sync;
 *   planZooms  instant ~12 % jump-zooms on punch words, and about every 6 s
 *              otherwise, so the picture never sits still for long.
 *
 * Times are clip-relative milliseconds. Pure functions, no FFmpeg.
 */
export interface Cut { a: number; b: number }
export interface W { w: string; t0: number; t1: number }

const FILLERS = new Set(["um", "uh", "uhm", "umm", "uhh", "erm", "er", "hmm", "mm", "ah"]);
export const isFiller = (w: string) => FILLERS.has(w.toLowerCase().replace(/[^a-z]/g, ""));

export function planCuts(words: W[], durMs: number): Cut[] {
  const cuts: Cut[] = [];
  const ws = words.filter((w) => w.t1 > 0 && w.t0 < durMs).sort((a, b) => a.t0 - b.t0);
  for (let i = 0; i + 1 < ws.length; i++) {
    const a = ws[i].t1 + 150, b = ws[i + 1].t0 - 150;
    if (ws[i + 1].t0 - ws[i].t1 > 450 && b - a >= 150) cuts.push({ a, b });
  }
  ws.forEach((w, i) => {
    if (!isFiller(w.w)) return;
    const lo = i > 0 ? ws[i - 1].t1 : 0, hi = i + 1 < ws.length ? ws[i + 1].t0 : durMs;
    cuts.push({ a: Math.max(lo, w.t0 - 40), b: Math.min(hi, w.t1 + 40) });
  });
  // Merge, drop slivers.
  const merged: Cut[] = [];
  for (const c of cuts.filter((c) => c.b - c.a >= 120 && c.a >= 0 && c.b <= durMs).sort((x, y) => x.a - y.a)) {
    const last = merged[merged.length - 1];
    if (last && c.a <= last.b + 20) last.b = Math.max(last.b, c.b);
    else merged.push({ ...c });
  }
  // Never cut more than 35 % or below 8 s: keep the biggest cuts.
  const budget = Math.min(durMs * 0.35, Math.max(0, durMs - 8000));
  const keep = new Set<Cut>();
  let used = 0;
  for (const c of [...merged].sort((x, y) => (y.b - y.a) - (x.b - x.a))) {
    if (used + (c.b - c.a) > budget) continue;
    keep.add(c); used += c.b - c.a;
  }
  return merged.filter((c) => keep.has(c)).slice(0, 80);
}

/** Original clip time → time after the cuts (a time inside a cut snaps to where it was). */
export function mapTime(t: number, cuts: Cut[]): number {
  let removed = 0;
  for (const c of cuts) {
    if (t >= c.b) removed += c.b - c.a;
    else if (t > c.a) return c.a - removed;
    else break;
  }
  return t - removed;
}

export const cutTotal = (cuts: Cut[]) => cuts.reduce((s, c) => s + c.b - c.a, 0);

/** FFmpeg select/aselect expression that DROPS the cuts (commas escaped for a filtergraph). */
export function keepExpr(cuts: Cut[]): string {
  return `not(${cuts.map((c) => `between(t\\,${(c.a / 1000).toFixed(3)}\\,${(c.b / 1000).toFixed(3)})`).join("+")})`;
}

export function planZooms(words: W[], durMs: number): Cut[] {
  const segs: Cut[] = [];
  let lastEnd = 0;
  for (const w of words) {
    if (w.t0 < 300 || w.t0 > durMs - 400) continue;
    if (isPowerWord(w.w)) { segs.push({ a: w.t0 - 50, b: Math.min(durMs, w.t1 + 350) }); lastEnd = w.t1 + 350; }
    else if (w.t0 - lastEnd > 6000) { segs.push({ a: w.t0, b: Math.min(durMs, w.t0 + 1600) }); lastEnd = w.t0 + 1600; }
  }
  const merged: Cut[] = [];
  for (const s of segs.sort((x, y) => x.a - y.a)) {
    const last = merged[merged.length - 1];
    if (last && s.a <= last.b + 250) last.b = Math.max(last.b, s.b);
    else merged.push({ ...s });
  }
  return merged.slice(0, 30);
}

export function enableExpr(segs: Cut[]): string {
  return segs.map((s) => `between(t\\,${(s.a / 1000).toFixed(3)}\\,${(s.b / 1000).toFixed(3)})`).join("+");
}
