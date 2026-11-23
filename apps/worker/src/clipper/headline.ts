import type { Env } from "./env";
import { completeWithFallbacks } from "../pocketathlete/index";

/**
 * A headline for a clip the engine left without one (AI scoring was down, or
 * an older project). One short AI call; if that fails, the opening line as a
 * quote — "“I LOST MY SENSE OF TASTE”" — which is a viral style of its own.
 */
export async function writeHeadline(env: Env, text: string, creator?: string | null): Promise<string | null> {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  try {
    const out = await completeWithFallbacks(env, {
      system: `You write the on-screen HEADLINE for a short clip cut from a long video: WHO (a real name if one is given or said; else a role like "DOCTOR", "HOST", "GUEST") + WHAT happens, present tense, 4-9 words, ALL CAPS, specific and vivid, e.g. "KAI CENAT CRASHES OUT AT FAST FOOD WORKER". Don't invent anything that isn't in the clip. Respond ONLY with JSON: {"headline":"..."}`,
      user: `${creator ? `Channel/creator: ${creator}\n` : ""}Clip transcript:\n${t.slice(0, 2500)}`,
      maxTokens: 300, json: true, priority: true,
      validate: (x) => { try { return typeof JSON.parse(x.slice(x.indexOf("{"), x.lastIndexOf("}") + 1)).headline === "string"; } catch { return false; } },
    });
    const h = String(JSON.parse(out.text.slice(out.text.indexOf("{"), out.text.lastIndexOf("}") + 1)).headline)
      .replace(/[#\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/\s+/g, " ").trim().toUpperCase();
    if (h) return h.slice(0, 80);
  } catch (e) { console.warn(`headline: ${String(e).slice(0, 300)}`); }
  return quoteHeadline(t);
}

/** The clip's first sentence (≤ 8 words) as an on-screen quote. */
export function quoteHeadline(text: string): string | null {
  const first = text.split(/(?<=[.?!])\s+/)[0] ?? "";
  const words = first.replace(/["“”]/g, "").split(/\s+/).filter(Boolean).slice(0, 8);
  if (words.length < 3) return null;
  return `“${words.join(" ").replace(/[,;:]$/, "").toUpperCase()}${first.split(/\s+/).filter(Boolean).length > 8 ? "…" : ""}”`.slice(0, 80);
}
