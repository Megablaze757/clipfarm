import type { Candidate, Word } from "../lib/types";
import { llm, parseJsonObject } from "../lib/worker";
import { finalScore } from "./scoring";
import { MIN_CLIP_MS } from "./boundaries";
import { textOf } from "./text";
import { sourceLine, type SourceInfo } from "./moments";

/**
 * Pass 2 of the clip engine: JUDGING. Batches of 12 candidates per call
 * through the shared AI ladder (Groq → OpenRouter → NVIDIA; the Worker
 * decides). The rubric follows the evidence:
 *  - hook / completion: what short-form platforms rank on;
 *  - payoff: curiosity gaps opened and closed (Loewenstein);
 *  - emotion: high-arousal content is shared more (Berger & Milkman 2012);
 *  - shareability: sends, debates, "this is so me".
 * Scores are 0-10 with anchors, so different models land on the same scale.
 * The judge can also trim a slow lead-in or a trailing ramble so the clip
 * starts ON its hook. If a batch fails, those candidates keep their heuristic
 * scores — the pipeline never stalls on AI.
 */
const SYSTEM = `You are judging candidate clips cut from a long podcast/stream, for TikTok, Reels and Shorts.
Judge each excerpt as a STANDALONE clip seen by a stranger scrolling a feed.
When an excerpt says the live chat reacted, that is real audience evidence: weigh it into emotion and shareability, but still judge whether a stranger would get it.
Score every dimension 0-10 using these anchors (be harsh; most moments are 3-6):
- hook: would the FIRST LINE stop the scroll? 9-10 bold claim/shocking number/conflict/"you're doing X wrong"; 5 decent intro; 0-2 filler, "so yeah", "anyway".
- payoff: does it open a question or tension and RESOLVE it inside the clip? 9-10 setup→twist/punchline/answer; 5 informative but flat; 0-2 never resolves or resolves off-clip.
- emotion: intensity of HIGH-AROUSAL emotion — amusement, awe, outrage, anxiety, excitement. 9-10 laugh-out-loud or jaw-drop; 5 mildly interesting; 0-2 calm/flat/sad-and-slow.
- shareability: would someone send it to a friend, stitch it, or argue in comments? 9-10 hot take / "tag someone who" / must-know tip; 0-2 nobody would share.
- self_contained: can a stranger follow it WITH its on-screen headline (below)? The headline can name who it is and where they are; 0-2 only if it needs more than one line of context (a long story from earlier).
- complete: does it end on a finished thought or punchline (ideally a satisfying or loopable last line)? 0-2 if it ends mid-argument.
Also return:
- category: one of story, hot_take, surprising_fact, funny, practical_tip, emotional, debate, quotable, reveal
- title: a scroll-stopping title, max 8 words, no hashtags/emojis, no clickbait the clip doesn't deliver
- context_title: the HEADLINE burned on screen for the WHOLE clip — the context a stranger needs, the way viral clip pages write them. WHO (the real name: the streamer/channel from the source line, or a name said in the clip; else a role like "DOCTOR", "COMEDIAN", "STREAMER") + WHAT happens, present tense, 4-9 words, specific and vivid. Examples: "KAI CENAT CRASHES OUT AT FAST FOOD WORKER", "DOCTOR EXPLAINS WHY YOU WAKE UP AT 3AM", "STREAMER'S MOM WALKS IN MID-RANT". Don't give away the punchline word for word, don't invent names or events that aren't in the clip, no emojis/hashtags. If the source line names the channel/streamer, the clip is THEIR content: name them (as people know them — "KaiCenat" → "KAI CENAT"), never a generic "STREAMER"/"HOST"
- alt_titles: TWO more headlines for the same clip, each a different angle (e.g. the reaction, the stakes, a question) — same rules as context_title
- hook_line: the strongest opening line, copied from the excerpt
- trim_start_words: how many words to cut from the START so the clip opens on its hook (0 if it already does; never cut needed context)
- trim_end_words: how many words to cut from the END to drop a trailing ramble (0 if the ending is right)
- rationale: why it will (or won't) perform, max 12 words
Respond ONLY with JSON: {"clips":[{"id":number,"hook":n,"payoff":n,"emotion":n,"shareability":n,"self_contained":n,"complete":n,"category":"...","title":"...","context_title":"...","alt_titles":["...","..."],"hook_line":"...","trim_start_words":n,"trim_end_words":n,"rationale":"..."}]}`;

interface Judged {
  id: number; hook: number; payoff: number; emotion: number; shareability: number; self_contained: number; complete: number;
  category?: string; title?: string; context_title?: string; alt_titles?: string[]; hook_line?: string; trim_start_words?: number; trim_end_words?: number; rationale?: string;
}

/** 0-10 (or 0-1, or 0-100) → 0-1. */
const n01 = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n > 10 ? n / 100 : n > 1 ? n / 10 : n));
};

/** Score multiplier for clips the AI never reviewed, once others have been. */
export const UNREVIEWED_PENALTY = 0.85;

export async function refineWithLLM(cands: Candidate[], words: Word[], batchSize = 12, source: SourceInfo = {}): Promise<{ refined: number; model: string | null }> {
  let refined = 0;
  let model: string | null = null;

  const runBatches = async (pool: Candidate[], size: number) => {
    const batches: Candidate[][] = [];
    for (let b = 0; b < pool.length; b += size) batches.push(pool.slice(b, b + size));
    for (let b = 0; b < batches.length; b += 3) {
      await Promise.all(batches.slice(b, b + 3).map(judge));
    }
  };

  // Pass A: batches of 12, three at a time.
  // Pass B: models sometimes return only part of a batch (seen live: 3 of 12),
  // so anything skipped is asked again in smaller batches of 6.
  await runBatches(cands, batchSize);
  const skipped = cands.filter((c) => c.features.scorer !== "llm");
  if (skipped.length && refined > 0) await runBatches(skipped, 6);

  // The judge is deliberately harsh (anchors: most moments score 3-6), so an
  // unreviewed clip's optimistic heuristic score must not outrank reviewed ones.
  if (refined > 0) {
    for (const c of cands) {
      if (c.features.scorer === "llm") continue;
      c.features.score_factor = UNREVIEWED_PENALTY;
      c.score = finalScore(c);
      c.features.signals.push("not AI-reviewed");
    }
  }
  return { refined, model };

  async function judge(batch: Candidate[]): Promise<void> {
      const user = batch.map((c, k) => {
        const secs = Math.round((c.t_out_ms - c.t_in_ms) / 1000);
        const chat = c.features.chat ? ` (live chat reacted: ${c.features.chat.kind}, ${c.features.chat.ratio}x normal rate — "${c.features.chat.sample.slice(0, 2).join('", "')}")` : "";
        const hint = (c.features.nominated ? ` (editor flagged: ${c.features.category ?? "moment"})` : "") + chat;
        return `### id ${k} — ${secs}s${hint}\n${c.text.slice(0, 1600)}`;
      }).join("\n\n");
      const res = await llm(SYSTEM, sourceLine(source) + user, 3000);
      const parsed = res ? parseJsonObject<{ clips?: Judged[] }>(res.text) : null;
      if (!parsed?.clips?.length) return;
      model = res!.model;
      for (const j of parsed.clips) {
        const c = batch[Number(j.id)];
        if (!c) continue;
        const s = c.subscores;
        // Blend, don't replace: the heuristics see audio energy, reactions and
        // timing the model can't.
        const mix = (key: keyof typeof s, v: number | null, w: number) => { if (v != null) s[key] = w * v + (1 - w) * s[key]; };
        mix("hook", n01(j.hook), 0.65);
        mix("structure", n01(j.payoff), 0.65);
        mix("emotion", n01(j.emotion), 0.6);
        mix("shareability", n01(j.shareability), 0.7);
        mix("self_contained", n01(j.self_contained), 0.5);
        mix("complete", n01(j.complete), 0.5);

        // Tighten: start on the hook, drop a trailing ramble — within limits.
        const len = c.i1 - c.i0 + 1;
        const cutStart = Math.max(0, Math.min(Math.floor(len * 0.4), Math.round(Number(j.trim_start_words) || 0)));
        const cutEnd = Math.max(0, Math.min(Math.floor(len * 0.25), Math.round(Number(j.trim_end_words) || 0)));
        const i0 = c.i0 + cutStart, i1 = c.i1 - cutEnd;
        if ((cutStart || cutEnd) && i1 > i0 && words[i1].t1 - words[i0].t0 >= MIN_CLIP_MS) {
          c.i0 = i0; c.i1 = i1;
          c.t_in_ms = words[i0].t0; c.t_out_ms = words[i1].t1;
          c.text = textOf(words, i0, i1);
          c.features.signals.push("tightened to the hook");
        }

        if (typeof j.title === "string" && j.title.trim()) c.features.title = j.title.trim().slice(0, 80);
        if (typeof j.context_title === "string" && j.context_title.trim()) {
          c.features.context_title = cleanHeadline(j.context_title, source);
          const alts = (Array.isArray(j.alt_titles) ? j.alt_titles : []).filter((t): t is string => typeof t === "string" && !!t.trim()).map((t) => cleanHeadline(t, source));
          c.features.headline_options = [...new Set([c.features.context_title, ...alts])].slice(0, 3);
        }
        if (typeof j.hook_line === "string" && j.hook_line.trim()) c.features.hook_line = j.hook_line.trim().slice(0, 140);
        if (typeof j.category === "string" && j.category.trim()) c.features.category = j.category.trim().slice(0, 30);
        if (typeof j.rationale === "string" && j.rationale.trim()) c.rationale = j.rationale.trim().split(/\s+/).slice(0, 12).join(" ");
        c.features.scorer = "llm";
        c.features.model = res!.model;
        c.score = finalScore(c);
        refined++;
      }
  }
}


/** "KaiCenat" / "kai_cenat" → "KAI CENAT": how a channel name reads in a headline. */
export function displayName(creator?: string): string | null {
  const n = (creator ?? "").replace(/[_.-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
  return n ? n.toUpperCase() : null;
}

/** Uppercase, no emojis/hashtags, and a generic "STREAMER …" becomes the real name when we know it. */
export function cleanHeadline(raw: string, source: SourceInfo = {}): string {
  let h = raw.replace(/#\S+/g, "").replace(/[#\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/\s+/g, " ").trim().toUpperCase();
  const name = displayName(source.creator);
  if (name) h = h.replace(/^(THE\s+)?(STREAMER|HOST|YOUTUBER|CREATOR|GAMER)('S)?\b/, (_m, _the, _w, poss) => name + (poss ?? ""));
  return h.slice(0, 70);
}

/**
 * Every picked clip gets a headline AND three options to choose from: any the
 * judge didn't write (it skipped the clip, dropped alt_titles, or the batch
 * failed) are written in one short follow-up call. If even that fails, a plain
 * "NAME — TITLE" fallback.
 */
export async function ensureHeadlines(cands: Candidate[], source: SourceInfo = {}): Promise<number> {
  const missing = cands.filter((c) => !c.features.context_title);
  const todo = cands.filter((c) => !c.features.context_title || (c.features.headline_options?.length ?? 0) < 3).slice(0, 25);
  if (todo.length) {
    const sys = `You write the on-screen HEADLINE for short clips cut from a long video: WHO (the real name — the channel/streamer from the source line, or a name said in the clip; never a generic "STREAMER") + WHAT happens, present tense, 4-9 words, ALL CAPS, specific and vivid, e.g. "KAI CENAT CRASHES OUT AT FAST FOOD WORKER". Don't invent anything that isn't in the clip. For each clip give THREE different headlines, each a different angle (what happens, the reaction, the stakes or a question). If a clip already has a headline, keep it as the first and write two new ones. Respond ONLY with JSON: {"headlines":[{"id":number,"options":["...","...","..."]}]}`;
    const user = sourceLine(source) + todo.map((c, k) => `### id ${k}${c.features.context_title ? ` (current headline: ${c.features.context_title})` : ""}\n${c.text.slice(0, 1200)}`).join("\n\n");
    const res = await llm(sys, user, 1600).catch(() => null);
    const parsed = res ? parseJsonObject<{ headlines?: { id: number; options?: unknown; headline?: unknown }[] }>(res.text) : null;
    for (const h of parsed?.headlines ?? []) {
      const c = todo[Number(h.id)];
      if (!c) continue;
      const raw = [...(Array.isArray(h.options) ? h.options : []), h.headline];
      const opts = raw.filter((t): t is string => typeof t === "string" && !!t.trim()).map((t) => cleanHeadline(t, source));
      if (!opts.length) continue;
      if (!c.features.context_title) c.features.context_title = opts[0];
      c.features.headline_options = [...new Set([c.features.context_title, ...(c.features.headline_options ?? []), ...opts])].slice(0, 3);
    }
  }
  const name = displayName(source.creator);
  for (const c of missing) {
    if (c.features.context_title || !c.features.title) continue;
    c.features.context_title = cleanHeadline(name ? `${name} — ${c.features.title}` : c.features.title, source);
  }
  for (const c of cands) if (c.features.context_title && !c.features.headline_options?.length) c.features.headline_options = [c.features.context_title];
  return missing.filter((c) => c.features.context_title).length;
}
