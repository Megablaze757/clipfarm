import type { Env } from "./env";
import { completeWithFallbacks } from "../pocketathlete/index";

/**
 * TRANSLATED CAPTIONS — one clip, several markets. The clip's words are
 * grouped into short caption lines with their timings, the AI translates the
 * lines (keeping the speaker's tone and slang), and each translated line is
 * spread back over the same time span, word by word, so karaoke highlighting
 * still follows the speech. The headline is translated in the same call.
 *
 * Latin-script languages only: the caption fonts (Montserrat, Anton) cover
 * them, accents included. Cached in the bucket per clip + language + text.
 */
export const LANGUAGES: Record<string, string> = {
  es: "Spanish", pt: "Portuguese (Brazil)", fr: "French", de: "German", it: "Italian",
  nl: "Dutch", pl: "Polish", tr: "Turkish", id: "Indonesian",
};

interface Word { i?: number; w: string; t0: number; t1: number; speaker?: string }

function lines(words: Word[]): { text: string; t0: number; t1: number }[] {
  const out: { text: string; t0: number; t1: number; n: number }[] = [];
  for (const w of words) {
    const last = out[out.length - 1];
    const gap = last ? w.t0 - last.t1 : 0;
    if (!last || last.n >= 8 || gap > 600 || /[.?!]$/.test(out[out.length - 1]?.text ?? "")) out.push({ text: w.w, t0: w.t0, t1: w.t1, n: 1 });
    else { last.text += ` ${w.w}`; last.t1 = w.t1; last.n++; }
  }
  return out.map(({ text, t0, t1 }) => ({ text, t0, t1 }));
}

async function key(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function translateCaptions(env: Env, clipId: string, words: Word[], headline: string | undefined, lang: string):
  Promise<{ words: Word[]; headline?: string } | null> {
  const name = LANGUAGES[lang];
  if (!name || !words.length) return null;
  const ls = lines(words);
  const cacheKey = `_clipper/translations/v2-${clipId}-${lang}-${await key(JSON.stringify([ls.map((l) => l.text), headline ?? ""]))}.json`;
  const cached = await env.R2_BUCKET.get(cacheKey);
  if (cached) return (await cached.json()) as { words: Word[]; headline?: string };

  // Lines go out NUMBERED and come back keyed by number, so a model that merges
  // or splits a line can't shift every later caption; a missing line keeps the
  // original words instead of failing the whole translation.
  const numbered = Object.fromEntries(ls.map((l, k) => [String(k + 1), l.text]));
  const parse = (t: string): { lines: string[]; headline?: string } | null => {
    try {
      const j = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) as { lines?: unknown; headline?: unknown };
      const src = j.lines;
      const got = Array.isArray(src) && src.length === ls.length
        ? src.map((x) => String(x ?? ""))
        : src && typeof src === "object" && !Array.isArray(src)
          ? ls.map((_, k) => String((src as Record<string, unknown>)[String(k + 1)] ?? ""))
          : null;
      if (!got || got.filter((x) => x.trim()).length < Math.ceil(ls.length * 0.85)) return null;
      return { lines: got.map((x, k) => (x.trim() ? x : ls[k].text)), headline: typeof j.headline === "string" ? j.headline : undefined };
    } catch { return null; }
  };
  const out = await completeWithFallbacks(env, {
    system: `You translate short-form video captions into ${name}. Keep the speaker's tone, slang and energy — natural spoken ${name}, not formal text. Keep each line about as short as the original (captions show 2-4 words at a time). Keep people's names, brands and numbers exactly as written — never swap a name for a generic word like "streamer". The input is {"lines":{"1":"...","2":"..."},"headline":"..."}. Respond ONLY with JSON in the same shape: {"lines":{"1":"...","2":"...", ...},"headline":"..."} — one translated line for EVERY number, same numbers.`,
    user: JSON.stringify({ lines: numbered, headline: headline ?? "" }),
    maxTokens: Math.min(4000, 300 + ls.length * 45),
    json: true,
    priority: true,
    validate: (t) => parse(t) !== null,
  });
  const j = parse(out.text)!;
  // Spread each translated line over its original time span, by word length.
  const res: Word[] = [];
  ls.forEach((l, k) => {
    const ws = String(j.lines[k] ?? "").trim().split(/\s+/).filter(Boolean);
    if (!ws.length) return;
    const total = ws.reduce((s, w) => s + w.length + 1, 0);
    let t = l.t0;
    for (const w of ws) {
      const d = ((w.length + 1) / total) * (l.t1 - l.t0);
      res.push({ w, t0: Math.round(t), t1: Math.round(t + d * 0.92) });
      t += d;
    }
  });
  const result = { words: res, headline: j.headline?.trim() ? j.headline.trim().toUpperCase().slice(0, 80) : undefined };
  await env.R2_BUCKET.put(cacheKey, JSON.stringify(result));
  return result;
}
