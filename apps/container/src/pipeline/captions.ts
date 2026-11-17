/**
 * §6.7 caption timing + FR-9.x styles, emitted as ASS for libass to burn in.
 *
 * Words → lines (viral styles: ≤3 words / ≤22 chars — what Hormozi-style
 * clips use; classic: ≤5 / ≤32), never ending on an article or
 * preposition (no orphans) → each line shown from 80 ms before its first word
 * to 120 ms after its last → one event per word so the active word is
 * highlighted (karaoke).
 */
export interface CapWord { w: string; t0: number; t1: number }
export interface Line { words: CapWord[]; t0: number; t1: number }

const ORPHANS = new Set(["a", "an", "the", "of", "to", "in", "on", "for", "and", "but", "or", "with", "at", "by", "my", "your", "our"]);

export function breakLines(words: CapWord[], MAX_WORDS = 5, MAX_CHARS = 32): Line[] {
  const lines: CapWord[][] = [];
  let cur: CapWord[] = [];
  const len = (ws: CapWord[]) => ws.map((w) => w.w).join(" ").length;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const gap = cur.length ? w.t0 - cur[cur.length - 1].t1 : 0;
    if (cur.length && (cur.length >= MAX_WORDS || len([...cur, w]) > MAX_CHARS || gap > 600)) {
      // Never end a line on an article/preposition: carry it to the next line.
      const carry: CapWord[] = [];
      if (cur.length > 1 && gap <= 600 && ORPHANS.has(cur[cur.length - 1].w.toLowerCase().replace(/[^a-z]/g, ""))) {
        carry.push(cur.pop()!);
      }
      lines.push(cur);
      cur = carry;
    }
    cur.push(w);
    if (/[.?!]$/.test(w.w)) { lines.push(cur); cur = []; }
  }
  if (cur.length) lines.push(cur);
  const out = lines.filter((l) => l.length).map((ws) => ({ words: ws, t0: Math.max(0, ws[0].t0 - 80), t1: ws[ws.length - 1].t1 + 120 }));
  for (let i = 0; i + 1 < out.length; i++) if (out[i].t1 > out[i + 1].t0) out[i].t1 = out[i + 1].t0;
  return out;
}

interface Style {
  font: string; size: number; primary: string; highlight: string | null; outline: string; border: 1 | 3; outlineW: number; upper: boolean; shadow?: number;
  /** Words per caption group (viral styles: 2–3). */ words?: number; chars?: number;
  /** The spoken word pops in (scales from 118% to 100%). */ pop?: boolean;
}

/**
 * Fonts ship with the pipeline (apps/container/fonts, SIL Open Font Licence):
 * Montserrat Black/ExtraBold — the heavy geometric sans most viral podcast
 * clips use — and Anton, the tall condensed "MrBeast-style" face. The family
 * names below are the fonts' own; the weight is in the family, so Bold is off
 * (libass would otherwise fake-embolden an already heavy face).
 */
const STYLES: Record<string, Style> = {
  // ASS colours are &HAABBGGRR
  karaoke_yellow: { font: "Montserrat Black",     size: 0.070, primary: "&H00FFFFFF", highlight: "&H0000E1FF", outline: "&H00000000", border: 1, outlineW: 0.008, upper: true, shadow: 3, words: 3, chars: 22, pop: true },
  bold_pop:       { font: "Anton",                size: 0.080, primary: "&H00FFFFFF", highlight: "&H0035F24A", outline: "&H00000000", border: 1, outlineW: 0.009, upper: true, shadow: 4, words: 2, chars: 16, pop: true },
  neon_box:       { font: "Montserrat ExtraBold", size: 0.062, primary: "&H00FFFFFF", highlight: "&H00FFFF00", outline: "&H990F0A0A", border: 3, outlineW: 0.012, upper: false, words: 4, chars: 26 },
  classic:        { font: "Montserrat ExtraBold", size: 0.055, primary: "&H00FFFFFF", highlight: null,        outline: "&H00000000", border: 1, outlineW: 0.005, upper: false, shadow: 2 },
};

const ts = (ms: number) => {
  const cs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
};
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, " ");

/** Builds the .ass file. `words` times are relative to the clip start. */
export function buildAss(words: CapWord[], styleId: string, w: number, h: number, opts: { middle?: boolean } = {}): string {
  const st = STYLES[styleId] ?? STYLES.karaoke_yellow;
  const size = Math.round(Math.min(w, h * 0.5625) * st.size * 1.4);
  const outline = Math.max(2, Math.round(w * st.outlineW));
  // Normally above TikTok/Reels bottom UI (FR-8.6 safe area); in split screen,
  // on the seam between speaker and background, where viewers' eyes sit.
  const marginV = opts.middle ? 0 : Math.round(h * 0.22);
  const align = opts.middle ? 5 : 2;
  const marginH = Math.round(w * 0.08);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${st.font},${size},${st.primary},${st.primary},${st.outline},&H80000000,0,0,0,0,100,100,0,0,${st.border},${outline},${st.shadow ?? 0},${align},${marginH},${marginH},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events: string[] = [];
  for (const line of breakLines(words, st.words ?? 5, st.chars ?? 32)) {
    const texts = line.words.map((x) => esc(st.upper ? x.w.toUpperCase() : x.w));
    if (!st.highlight) {
      events.push(`Dialogue: 0,${ts(line.t0)},${ts(line.t1)},Cap,,0,0,0,,${texts.join(" ")}`);
      continue;
    }
    line.words.forEach((word, k) => {
      const start = k === 0 ? line.t0 : word.t0;
      const end = k + 1 < line.words.length ? line.words[k + 1].t0 : line.t1;
      if (end <= start) return;
      const on = st.pop ? `{\\c${st.highlight}\\fscx118\\fscy118\\t(0,110,\\fscx100\\fscy100)}` : `{\\c${st.highlight}}`;
      const off = st.pop ? `{\\c${st.primary}\\fscx100\\fscy100}` : `{\\c${st.primary}}`;
      const text = texts.map((t, j) => (j === k ? `${on}${t}${off}` : t)).join(" ");
      events.push(`Dialogue: 0,${ts(start)},${ts(end)},Cap,,0,0,0,,${text}`);
    });
  }
  return header + events.join("\n") + "\n";
}

/** FR-9.6 SRT export. */
export function buildSrt(words: CapWord[]): string {
  const t = (ms: number) => ts(ms).replace(/^(\d+):/, (_m, h) => `${String(h).padStart(2, "0")}:`).replace(".", ",") + "0";
  return breakLines(words).map((l, i) => `${i + 1}\n${t(l.t0)} --> ${t(l.t1)}\n${l.words.map((w) => w.w).join(" ")}\n`).join("\n");
}
