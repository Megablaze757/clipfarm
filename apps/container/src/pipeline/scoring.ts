import type { Candidate, Envelope, Subscores, Word } from "../lib/types";
import { FRAME_MS } from "../lib/types";
import { bare, endsSentence, jaccard, textOf, tokens } from "./text";
import { PRONOUNS, type Window } from "./candidates";

/**
 * Composite weights (engine v2). Grounded in what's actually evidenced:
 *  - hook: platforms rank on early swipe-away and completion;
 *  - self_contained: a clip a stranger can't follow doesn't get finished;
 *  - structure (setup → payoff): curiosity gaps hold attention when they're
 *    opened AND closed (Loewenstein's information-gap theory);
 *  - emotion: high-arousal content is shared more (Berger & Milkman 2012);
 *  - shareability: identity, practical value and arguable takes drive sends;
 *  - reaction: laughter/applause mark highlights (stream-highlight tooling).
 * Sums to 1. Novelty is filled in by MMR selection.
 */
export const WEIGHTS: Subscores = {
  hook: 0.22, self_contained: 0.16, structure: 0.14, emotion: 0.12, shareability: 0.1,
  complete: 0.1, energy: 0.06, reaction: 0.05, novelty: 0.05,
};
export const SCORER_VERSION = "clipper-2026.11.2";

const AROUSAL = /\b(insane|crazy|unbelievable|shocking|shocked|terrified|scared|furious|angry|hate|love|obsessed|amazing|incredible|mind[- ]?blowing|wild|ridiculous|disgusting|heartbroken|cried|screaming|panic|nightmare|genius|brutal|epic|hilarious|lmao|wtf|holy)\b/gi;
const SHAREABLE = /\b(you|your|everyone|anyone|people who|if you|how to|the secret|tip|mistake|stop doing|never do|always do|here'?s how|step|trick|hack|rule|lesson|truth about|unpopular opinion|hot take|controversial|i disagree|that'?s wrong|nobody talks about)\b/gi;
const ANSWER = /\b(because|turns out|the answer|the reason|that'?s why|so what (we|i) did|here'?s what|it was|the secret|what happened)\b/i;

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

/**
 * Audience reactions — laughter, applause, cheering — show up as LOUD audio
 * where nobody is speaking (no transcript words). Returns their times (ms).
 * Threshold: the source's own 85th-percentile loudness, so a quiet podcast and
 * a loud stream are both judged against themselves.
 */
export function reactionEvents(words: Word[], env: Envelope): number[] {
  if (!env.length || !words.length) return [];
  const sorted = Float32Array.from(env).sort();
  const loud = sorted[Math.floor(sorted.length * 0.85)] || 0;
  if (loud <= 0.02) return [];
  const events: number[] = [];
  for (let i = 0; i + 1 < words.length; i++) {
    const g0 = words[i].t1 + 100, g1 = words[i + 1].t0 - 50;
    if (g1 - g0 < 400) continue;
    let run = 0;
    for (let f = Math.floor(g0 / FRAME_MS); f < Math.ceil(g1 / FRAME_MS) && f < env.length; f++) {
      run = env[f] >= loud ? run + 1 : 0;
      if (run >= 3) { events.push(f * FRAME_MS); break; } // ≥300 ms of loud non-speech
    }
  }
  return events;
}

/** Heuristic sub-scores. Always computed; the LLM refines them on top (cold-start safe, FR-6.6). */
export function heuristicScore(words: Word[], env: Envelope, w: Window, globalRate: number, reactions: number[] = []): Candidate {
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

  // Setup → payoff: structure words, plus a question/claim in the first half
  // that gets an answer-shaped sentence in the second half (gap opened AND closed).
  const structHits = (text.match(STRUCTURE) ?? []).length;
  const mid = w.i0 + Math.floor((w.i1 - w.i0) / 2);
  const firstHalf = textOf(words, w.i0, mid), secondHalf = textOf(words, mid, w.i1);
  const gapClosed = (/\?/.test(firstHalf) || HOOK_PHRASES.test(firstHalf)) && ANSWER.test(secondHalf);
  const structure = clamp01(0.3 + Math.min(3, structHits) * 0.12 + (gapClosed ? 0.3 : 0));
  if (gapClosed) { signals.push("question answered"); badges.push("🎯 Setup → payoff"); }
  else if (structHits >= 2) signals.push("setup → payoff");

  // Emotion (arousal): intense words, exclamations, loud variation.
  const arousalHits = (text.match(AROUSAL) ?? []).length + (text.match(/!/g) ?? []).length;
  const emotion = clamp01(0.25 + Math.min(4, arousalHits) * 0.12 + clamp01(envStd(env, w.t0, w.t1) * 3) * 0.25);
  if (emotion > 0.65) { signals.push("high emotion"); badges.push("💥 Emotional peak"); }

  // Shareability: speaks to the viewer, practical value, or an arguable take.
  const shareHits = (text.match(SHAREABLE) ?? []).length;
  const shareability = clamp01(0.3 + Math.min(5, shareHits) * 0.1);
  if (shareHits >= 3) signals.push("shareable");

  // Reaction: laughter/applause inside the clip or within 2.5 s after it ends.
  const inside = reactions.filter((t) => t >= w.t0 && t <= w.t1 + 2500);
  const atEnd = inside.some((t) => t >= w.t1 - 1500);
  const reaction = clamp01(inside.length * 0.25 + (atEnd ? 0.35 : 0));
  if (inside.length) { signals.push(atEnd ? "big reaction at the payoff" : "audience reaction"); badges.push("😂 Reaction"); }

  const subscores: Subscores = {
    hook: clamp01(hook), self_contained: sc.score, complete: clamp01(complete), energy, structure,
    emotion, shareability, reaction, novelty: 1,
  };
  return {
    i0: w.i0, i1: w.i1, t_in_ms: w.t0, t_out_ms: w.t1, text,
    subscores,
    score: composite(subscores),
    features: { badges: badges.slice(0, 3), signals, unresolved: sc.unresolved, scorer: "heuristic", reactions: inside.length },
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
