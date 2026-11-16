import type { Candidate, Envelope, Subscores, Word } from "../lib/types";
import { FRAME_MS } from "../lib/types";
import { bare, endsSentence, jaccard, textOf, tokens } from "./text";
import { PRONOUNS, type Window } from "./candidates";

/** §6.4 weights. Novelty is filled in by MMR selection. */
export const WEIGHTS: Subscores = { hook: 0.3, self_contained: 0.25, complete: 0.15, energy: 0.1, structure: 0.1, novelty: 0.1 };
export const SCORER_VERSION = "clipper-2026.11.1";

const SUPERLATIVES = /\b(best|worst|most|least|never|always|biggest|only|secret|nobody|everyone|everybody|crazy|insane|wrong|mistake|truth|actually|literally|million|billion)\b/i;
const HOOK_PHRASES = /\b(here'?s|the thing is|the truth|the reason|what if|why|how to|imagine|nobody tells|most people|you need|you should|stop|don'?t)\b/i;
const BACKREFS = /\b(as i said|like i said|i mentioned|we talked about|earlier|going back to|that guy|the other thing|as we discussed)\b/i;
const STRUCTURE = /\b(because|so that|which means|turns out|the reason|and then|first|second|finally|the lesson|here'?s why|that'?s why|the point is)\b/gi;
const TRAILING = new Set(["and", "but", "so", "or", "because", "uh", "um", "like", "the", "a", "to", "of"]);

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function envMean(env: Envelope, t0: number, t1: number): number {
  const a = Math.max(0, Math.floor(t0 / FRAME_MS));
  const b = Math.min(env.length, Math.ceil(t1 / FRAME_MS));
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) s += env[i];
  return s / (b - a);
}

function envStd(env: Envelope, t0: number, t1: number): number {
  const a = Math.max(0, Math.floor(t0 / FRAME_MS));
  const b = Math.min(env.length, Math.ceil(t1 / FRAME_MS));
  if (b - a < 2) return 0;
  const m = envMean(env, t0, t1);
  let s = 0;
  for (let i = a; i < b; i++) s += (env[i] - m) ** 2;
  return Math.sqrt(s / (b - a));
}

/**
 * Self-containedness (§6.4, the differentiator): a pronoun or back-reference
 * used before its antecedent appears inside the clip. Subjects (sentence
 * starts) weigh more than objects. Returns the score and the word that broke it.
 */
export function selfContainedness(words: Word[], w: Window): { score: number; unresolved: string | null } {
  let penalty = 0;
  let culprit: string | null = null;
  let introduced = false;
  const firstSentenceEnd = (() => { for (let i = w.i0; i <= w.i1; i++) if (endsSentence(words[i].w)) return i; return w.i1; })();
  for (let i = w.i0; i <= Math.min(w.i1, firstSentenceEnd + 12); i++) {
    const raw = words[i].w;
    const b = bare(raw);
    if (i > w.i0 && /^\p{Lu}/u.test(raw) && !PRONOUNS.has(b) && b !== "i") introduced = true;
    if (!introduced && PRONOUNS.has(b) && !["it", "its", "this", "that"].includes(b)) {
      const isSubject = i === w.i0 || endsSentence(words[i - 1].w);
      penalty += isSubject ? 0.35 : 0.15;
      culprit ??= b;
    } else if (!introduced && ["this", "that", "these", "those"].includes(b) && i === w.i0) {
      penalty += 0.15;
      culprit ??= b;
    }
  }
  const text = textOf(words, w.i0, Math.min(w.i1, w.i0 + 40));
  const back = text.match(BACKREFS);
  if (back) { penalty += 0.3; culprit ??= back[0]; }
  return { score: clamp01(1 - penalty), unresolved: culprit };
}

/** Heuristic sub-scores. Always computed; the LLM refines hook/structure on top (cold-start safe, FR-6.6). */
export function heuristicScore(words: Word[], env: Envelope, w: Window, globalRate: number): Candidate {
  const text = textOf(words, w.i0, w.i1);
  const signals: string[] = [];
  const badges: string[] = [];

  // Hook: what's said in the first ~3 s.
  let k = w.i0;
  while (k < w.i1 && words[k].t1 - w.t0 < 3500) k++;
  const opening = textOf(words, w.i0, k);
  let hook = 0.35;
  if (/\?/.test(opening) || /^(why|how|what|who|when|where|is|are|do|does|did|can|would|should)\b/i.test(opening)) { hook += 0.25; signals.push("question opener"); badges.push("⚡ Question hook"); }
  if (/\d/.test(opening)) { hook += 0.12; signals.push("numeric claim"); }
  if (SUPERLATIVES.test(opening)) { hook += 0.15; signals.push("strong claim"); badges.push("🔥 Bold claim"); }
  if (HOOK_PHRASES.test(opening)) { hook += 0.12; signals.push("curiosity gap"); }
  if (/\byou\b/i.test(opening)) { hook += 0.06; signals.push("speaks to viewer"); }
  const openEnergy = envMean(env, w.t0, w.t0 + 3000);
  const allEnergy = envMean(env, w.t0, w.t1);
  if (allEnergy > 0 && openEnergy > allEnergy * 1.15) { hook += 0.08; signals.push("energetic start"); }

  const sc = selfContainedness(words, w);
  if (sc.score >= 0.9) badges.push("🧠 Self-contained");

  // Completeness: ends on a full stop, not on a conjunction, followed by a pause.
  const last = words[w.i1];
  const gapAfter = w.i1 + 1 < words.length ? words[w.i1 + 1].t0 - last.t1 : 2000;
  let complete = 0.3;
  if (endsSentence(last.w)) complete += 0.35;
  if (!TRAILING.has(bare(last.w))) complete += 0.15;
  if (gapAfter >= 400) complete += 0.2;
  if (/\?["')]*$/.test(last.w)) complete -= 0.2; // ends on an unanswered question

  // Energy: loudness variation + speech rate vs the whole source.
  const durS = (w.t1 - w.t0) / 1000;
  const rate = (w.i1 - w.i0 + 1) / durS;
  const rateBoost = globalRate > 0 ? clamp01((rate / globalRate - 0.8) / 0.6) : 0.5;
  const energy = clamp01(0.5 * clamp01(envStd(env, w.t0, w.t1) * 4) + 0.3 * clamp01(allEnergy * 1.5) + 0.2 * rateBoost);
  if (energy > 0.7) badges.push("📈 High energy");

  const structHits = (text.match(STRUCTURE) ?? []).length;
  const structure = clamp01(0.35 + Math.min(4, structHits) * 0.15);
  if (structHits >= 2) signals.push("setup → payoff");

  const subscores: Subscores = { hook: clamp01(hook), self_contained: sc.score, complete: clamp01(complete), energy, structure, novelty: 1 };
  return {
    i0: w.i0, i1: w.i1, t_in_ms: w.t0, t_out_ms: w.t1, text,
    subscores,
    score: composite(subscores),
    features: { badges: badges.slice(0, 3), signals, unresolved: sc.unresolved, scorer: "heuristic" },
    rationale: templateRationale(signals, sc.unresolved),
  };
}

export function composite(s: Subscores): number {
  const v = (Object.keys(WEIGHTS) as (keyof Subscores)[]).reduce((acc, k) => acc + WEIGHTS[k] * s[k], 0);
  return Math.round(v * 10000) / 100;
}

/** §25.4 rationale fallback, ≤12 words. */
export function templateRationale(signals: string[], unresolved: string | null): string {
  if (!signals.length) return unresolved ? `Solid moment, but "${unresolved}" may need context.` : "Complete, self-contained thought with a clean ending.";
  const s = signals.slice(0, 2).join(" and ");
  return `${s[0].toUpperCase()}${s.slice(1)} with a clean ending.`.split(" ").slice(0, 12).join(" ");
}

/**
 * MMR selection (FR-5.4): score − λ·max similarity to what's already picked,
 * where similarity is the larger of time overlap and word overlap. Pairs over
 * 70 % overlap are never both selected.
 */
export function selectMMR(cands: Candidate[], n: number, lambda = 0.35): Candidate[] {
  const pool = cands.map((c) => ({ c, toks: tokens(c.text) })).sort((a, b) => b.c.score - a.c.score);
  const picked: typeof pool = [];
  const sim = (a: (typeof pool)[number], b: (typeof pool)[number]) => {
    const inter = Math.max(0, Math.min(a.c.t_out_ms, b.c.t_out_ms) - Math.max(a.c.t_in_ms, b.c.t_in_ms));
    const overlap = inter / Math.min(a.c.t_out_ms - a.c.t_in_ms, b.c.t_out_ms - b.c.t_in_ms);
    return { overlap, s: Math.max(overlap, jaccard(a.toks, b.toks)) };
  };
  while (picked.length < n && pool.length) {
    let best = -1, bestVal = -Infinity, bestSim = 0;
    for (let i = 0; i < pool.length; i++) {
      let maxSim = 0, tooClose = false;
      for (const p of picked) {
        const r = sim(pool[i], p);
        if (r.overlap >= 0.7) { tooClose = true; break; }
        maxSim = Math.max(maxSim, r.s);
      }
      if (tooClose) continue;
      const val = pool[i].c.score - lambda * 100 * maxSim;
      if (val > bestVal) { bestVal = val; best = i; bestSim = maxSim; }
    }
    if (best < 0) break;
    const [chosen] = pool.splice(best, 1);
    chosen.c.subscores.novelty = clamp01(1 - bestSim);
    chosen.c.score = composite(chosen.c.subscores);
    picked.push(chosen);
  }
  return picked.map((p) => p.c).sort((a, b) => b.score - a.score);
}
