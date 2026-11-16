import type { Sentence, Word } from "../lib/types";
import { llm, parseJsonObject } from "../lib/worker";
import { textOf } from "./text";

/**
 * Pass 1 of the clip engine: NOMINATION.
 *
 * Sliding windows + heuristics are good at "well-formed", bad at "this is the
 * moment people will share". So an LLM reads the WHOLE transcript, in ~10-min
 * blocks of numbered sentences, and nominates the moments a top short-form
 * editor would cut — each with a category and the line that hooks. These
 * windows then compete with the heuristic ones in pass 2 (llm-scoring.ts).
 *
 * Runs through the Worker's shared AI ladder; if every provider fails the
 * pipeline just continues with heuristic windows (never blocks a job).
 */
export interface Nomination {
  s0: number; // first sentence index
  s1: number; // last sentence index (inclusive)
  category: string;
  hook: string;
  why: string;
}

export const CATEGORIES = ["story", "hot_take", "surprising_fact", "funny", "practical_tip", "emotional", "debate", "quotable", "reveal"] as const;

const SYSTEM = `You are the best short-form video editor in the world. You cut long podcasts and streams into clips that go viral on TikTok, Reels and Shorts.
You will get a numbered transcript block. Nominate the moments worth clipping. What makes a clip spread:
- HOOK: the first line stops the scroll — a bold claim, a question, a surprising number, a conflict, or a strong emotion. Prefer starting the clip ON that line.
- PAYOFF: it opens a curiosity gap and closes it inside the clip (setup → answer, story → twist, joke → punchline).
- HIGH-AROUSAL EMOTION: amusement, awe, outrage, anxiety, excitement. Calm or sad-and-flat moments rarely spread.
- SHAREABLE: a take people will argue about, advice they'd send a friend, something that says who the viewer is.
- STANDALONE: a stranger understands it with no context. Reject moments that depend on "he/they/that thing" from earlier.
- TIGHT: 15-60 seconds is ideal; up to 90 if the story needs it. No slow wind-up.
Categories: ${CATEGORIES.join(", ")}.
Be selective: only moments you'd actually post. It's fine to return none.
Respond ONLY with JSON: {"moments":[{"start":<sentence number>,"end":<sentence number>,"category":"...","hook":"<the opening line, verbatim-ish, max 15 words>","why":"<max 12 words>"}]}`;

const BLOCK_MS = 10 * 60 * 1000;
const OVERLAP_SENTENCES = 6;

export async function nominateMoments(words: Word[], sents: Sentence[], maxPerBlock = 6): Promise<Nomination[]> {
  if (!sents.length) return [];
  const blocks: { from: number; to: number }[] = [];
  let from = 0;
  while (from < sents.length) {
    let to = from;
    while (to + 1 < sents.length && sents[to + 1].t1 - sents[from].t0 < BLOCK_MS) to++;
    blocks.push({ from, to });
    if (to >= sents.length - 1) break;
    from = Math.max(from + 1, to + 1 - OVERLAP_SENTENCES);
  }

  const out: Nomination[] = [];
  // Four blocks at a time: a 1-hour source is 6 blocks, so ~2 rounds.
  for (let b = 0; b < blocks.length; b += 4) {
    const batch = blocks.slice(b, b + 4);
    const results = await Promise.all(batch.map(async ({ from, to }) => {
      const lines: string[] = [];
      for (let s = from; s <= to; s++) {
        const sec = Math.round(sents[s].t0 / 1000);
        lines.push(`[${s}] (${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}) ${textOf(words, sents[s].i0, sents[s].i1)}`);
      }
      const res = await llm(SYSTEM, `Nominate up to ${maxPerBlock} moments.\n\n${lines.join("\n")}`.slice(0, 55_000), 1500);
      const parsed = res ? parseJsonObject<{ moments?: { start: number; end: number; category?: string; hook?: string; why?: string }[] }>(res.text) : null;
      return (parsed?.moments ?? []).flatMap((m) => {
        const s0 = Math.round(Number(m.start)), s1 = Math.round(Number(m.end));
        if (!Number.isInteger(s0) || !Number.isInteger(s1) || s0 < from || s1 > to || s1 < s0) return [];
        const dur = sents[s1].t1 - sents[s0].t0;
        if (dur < 8000 || dur > 120_000) return [];
        const category = (CATEGORIES as readonly string[]).includes(String(m.category)) ? String(m.category) : "quotable";
        return [{ s0, s1, category, hook: String(m.hook ?? "").slice(0, 120), why: String(m.why ?? "").split(/\s+/).slice(0, 12).join(" ") }];
      });
    }));
    out.push(...results.flat());
  }
  // Overlapping blocks can nominate the same moment twice — keep the first.
  return out.filter((n, i) => !out.slice(0, i).some((m) => Math.max(m.s0, n.s0) <= Math.min(m.s1, n.s1) &&
    (Math.min(m.s1, n.s1) - Math.max(m.s0, n.s0) + 1) / (n.s1 - n.s0 + 1) > 0.6));
}
