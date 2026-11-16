import type { Candidate } from "../lib/types";
import { llm, parseJsonObject } from "../lib/worker";
import { composite } from "./scoring";

/**
 * §6.4 scoring pipeline: batches of 15 candidates per call through the shared
 * AI ladder (Groq first, then OpenRouter, then NVIDIA — the Worker decides).
 * The model refines hook / structure / self-containedness / completeness and
 * writes the title and rationale. If a batch fails to parse, or every provider
 * is down, those candidates keep their heuristic scores — the pipeline never
 * stalls on AI.
 */
const SYSTEM = `You rank moments from long-form video for short-form clips (TikTok/Reels/Shorts).
Judge each excerpt ONLY on whether it works as a standalone clip for someone who never saw the rest.
Score 0.0-1.0:
- hook: do the first ~3 seconds make a stranger keep watching? (question, bold claim, curiosity gap, surprise)
- self_contained: is every person/thing referred to introduced inside the excerpt? Penalise "he/she/they/that" with no antecedent.
- complete: does it end on a finished thought, not mid-argument?
- structure: does it have a setup and a payoff (story, argument, punchline, lesson)?
Also write:
- title: a punchy clip title, max 8 words, no hashtags, no emojis
- rationale: why it works (or doesn't), max 12 words, grounded in what is said
Respond ONLY with JSON: {"clips":[{"id":number,"hook":number,"self_contained":number,"complete":number,"structure":number,"title":string,"rationale":string}]}`;

interface Judged { id: number; hook: number; self_contained: number; complete: number; structure: number; title?: string; rationale?: string }

const n01 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v > 1 ? v / 100 : v)) : null);

export async function refineWithLLM(cands: Candidate[], batchSize = 15): Promise<{ refined: number; model: string | null }> {
  let refined = 0;
  let model: string | null = null;
  for (let b = 0; b < cands.length; b += batchSize) {
    const batch = cands.slice(b, b + batchSize);
    const user = batch.map((c, k) => `### id ${k}\n${c.text.slice(0, 1400)}`).join("\n\n");
    const res = await llm(SYSTEM, user, 2200);
    const parsed = res ? parseJsonObject<{ clips?: Judged[] }>(res.text) : null;
    if (!parsed?.clips?.length) continue;
    model = res!.model;
    for (const j of parsed.clips) {
      const c = batch[Number(j.id)];
      if (!c) continue;
      const hook = n01(j.hook), sc = n01(j.self_contained), comp = n01(j.complete), st = n01(j.structure);
      // Blend, don't replace: the heuristics see audio energy and timing the model can't.
      if (hook != null) c.subscores.hook = 0.6 * hook + 0.4 * c.subscores.hook;
      if (sc != null) c.subscores.self_contained = 0.5 * sc + 0.5 * c.subscores.self_contained;
      if (comp != null) c.subscores.complete = 0.5 * comp + 0.5 * c.subscores.complete;
      if (st != null) c.subscores.structure = 0.6 * st + 0.4 * c.subscores.structure;
      if (typeof j.title === "string" && j.title.trim()) c.features.title = j.title.trim().slice(0, 80);
      if (typeof j.rationale === "string" && j.rationale.trim()) c.rationale = j.rationale.trim().split(/\s+/).slice(0, 12).join(" ");
      c.features.scorer = "llm";
      c.features.model = res!.model;
      c.score = composite(c.subscores);
      refined++;
    }
  }
  return { refined, model };
}
