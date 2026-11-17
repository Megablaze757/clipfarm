/**
 * Chat analysis — the live audience as a clip detector.
 *
 * On a stream, chat explodes a few seconds AFTER something clip-worthy:
 * message rate jumps, and the messages turn into laugh / hype / shock emotes
 * ("KEKW", "LUL", "POG", "W", "no way", "clip it"). We find those bursts
 * against the stream's OWN baseline (a 300-viewer stream and a 30k one are
 * each judged against themselves), shift them back by chat's reaction delay,
 * and hand them to the engine: they boost windows that contain them, they're
 * marked in the transcript the AI reads, and the strongest ones become
 * candidates even if nothing else noticed them.
 *
 * Input is a chat log file the user exports (e.g. TwitchDownloader /
 * chat-downloader JSON, YouTube live-chat JSON, or timestamped text).
 */

export interface ChatMessage { t: number; text: string } // t = ms from stream start
export type ChatKind = "laugh" | "hype" | "shock" | "busy";
export interface ChatSpike {
  t: number;        // ms — where the MOMENT is (peak minus reaction delay)
  peak: number;     // ms — where chat peaked
  z: number;        // strength vs the stream's baseline (robust z-score)
  ratio: number;    // peak message rate ÷ typical rate
  kind: ChatKind;
  sample: string[]; // the most repeated messages in the burst
}
export interface ChatSignal { messages: number; spikes: ChatSpike[] }

// ---------------------------------------------------------------------------
// Parsing

const clock = (s: string): number | null => {
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d+))?$/);
  if (!m) return null;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + (m[4] ? Number(`0.${m[4]}`) * 1000 : 0);
};

const textOfRuns = (runs: unknown): string =>
  Array.isArray(runs) ? runs.map((r: any) => r?.text ?? r?.emoji?.shortcuts?.[0] ?? r?.emoji?.emojiId ?? "").join("") : "";

/** Parses the chat-log formats people actually have. Unknown lines are skipped. */
export function parseChat(raw: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  const s = raw.replace(/^﻿/, "").trim();
  if (!s) return out;

  const fromObj = (o: any) => {
    if (!o || typeof o !== "object") return;
    // TwitchDownloader: { content_offset_seconds, message: { body } }
    if (o.content_offset_seconds != null) {
      out.push({ t: Number(o.content_offset_seconds) * 1000, text: String(o.message?.body ?? o.message ?? "") });
      return;
    }
    // chat-downloader: { time_in_seconds, message }
    if (o.time_in_seconds != null) { out.push({ t: Number(o.time_in_seconds) * 1000, text: String(o.message ?? "") }); return; }
    // YouTube live chat replay (yt-dlp live_chat.json, one object per line)
    const replay = o.replayChatItemAction;
    if (replay) {
      const t = Number(replay.videoOffsetTimeMsec);
      for (const a of replay.actions ?? []) {
        const r = a?.addChatItemAction?.item?.liveChatTextMessageRenderer;
        if (r) out.push({ t, text: textOfRuns(r.message?.runs) });
      }
      return;
    }
    // Generic: { t | time | offset | seconds, text | message | msg }
    const t = o.t ?? o.time ?? o.offset ?? o.seconds ?? o.timestamp;
    const text = o.text ?? o.message ?? o.msg ?? o.body;
    if (t != null && text != null) {
      // Seconds, or a "h:mm:ss" clock.
      const ms = typeof t === "string" && t.includes(":") ? clock(t) : Number(t) * 1000;
      if (ms != null) out.push({ t: ms, text: String(text) });
    }
  };

  if (s[0] === "{" || s[0] === "[") {
    try {
      const j = JSON.parse(s);
      const list = Array.isArray(j) ? j : j.comments ?? j.messages ?? j.chat ?? [j];
      for (const o of list) fromObj(o);
      return clean(out);
    } catch { /* maybe JSON Lines — fall through */ }
  }
  for (const line of s.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    if (l[0] === "{") { try { fromObj(JSON.parse(l)); } catch { /* skip */ } continue; }
    // "[1:02:03] user: message" · "01:02:03 user: message" · "3723.5,message"
    let m = l.match(/^\[?(\d+(?::\d{1,2}){1,2}(?:\.\d+)?)\]?\s+(?:<[^>]*>|[^\s:]+:)?\s*(.*)$/);
    if (m) { const t = clock(m[1]); if (t != null) out.push({ t, text: m[2] }); continue; }
    m = l.match(/^(\d+(?:\.\d+)?)[,\t]\s*(?:[^,\t]*[,\t])?\s*(.*)$/);
    if (m) out.push({ t: Number(m[1]) * 1000, text: m[2] });
  }
  return clean(out);
}

function clean(ms: ChatMessage[]): ChatMessage[] {
  return ms.filter((m) => Number.isFinite(m.t) && m.t >= 0 && m.text.trim()).sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// Spikes

const LAUGH = /\b(kekw|lul|lulw|omegalul|lmao+|lmfao|lol+|haha+|ha(ha)+|icant|i can'?t|dead|💀|😂|🤣|xd+|pepelaugh|kek)\b|💀|😂|🤣/i;
const HYPE = /\b(pog+|pogchamp|poggers|pogu|w+|dub|lets go+|let'?s go+|hype|goat(ed)?|insane|clip it|clip that|clipped|holy|ez|gg|banger|peak)\b|🔥|🐐/i;
const SHOCK = /\b(no way|wtf|what\??|omg|monkas|monkaw|bruh|yikes|nah+|wait what|actually|\?+|sus)\b|😳|😱|^\?+$/i;

/** Chat lags the moment it's reacting to by a few seconds. */
const REACTION_DELAY_MS = 5000;
const BIN_MS = 1000;
const WIN_BINS = 6;          // 6 s burst window
const MIN_GAP_MS = 25_000;   // one spike per moment

export function chatSpikes(messages: ChatMessage[], durationMs: number, maxSpikes = 40): ChatSignal {
  if (messages.length < 50) return { messages: messages.length, spikes: [] };
  const nb = Math.max(1, Math.ceil(durationMs / BIN_MS));
  const count = new Float32Array(nb), weight = new Float32Array(nb);
  const laugh = new Float32Array(nb), hype = new Float32Array(nb), shock = new Float32Array(nb);
  for (const m of messages) {
    const b = Math.floor(m.t / BIN_MS);
    if (b < 0 || b >= nb) continue;
    count[b]++;
    const isL = LAUGH.test(m.text), isH = HYPE.test(m.text), isS = SHOCK.test(m.text);
    if (isL) laugh[b]++; if (isH) hype[b]++; if (isS) shock[b]++;
    // Reaction messages count more than chatter; caps-lock spam a little more.
    weight[b] += 1 + (isL || isH || isS ? 0.8 : 0) + (m.text.length > 3 && m.text === m.text.toUpperCase() && /[A-Z]/.test(m.text) ? 0.2 : 0);
  }
  // Sliding 6 s sums.
  const roll = new Float32Array(nb), rollN = new Float32Array(nb);
  let acc = 0, accN = 0;
  for (let i = 0; i < nb; i++) {
    acc += weight[i]; accN += count[i];
    if (i >= WIN_BINS) { acc -= weight[i - WIN_BINS]; accN -= count[i - WIN_BINS]; }
    roll[i] = acc; rollN[i] = accN;
  }
  // Robust baseline: median + MAD of the windows where chat is active at all.
  const active = Array.from(roll).filter((v) => v > 0).sort((a, b) => a - b);
  if (active.length < 30) return { messages: messages.length, spikes: [] };
  const med = active[Math.floor(active.length / 2)];
  const mad = active.map((v) => Math.abs(v - med)).sort((a, b) => a - b)[Math.floor(active.length / 2)] || 1;
  const medN = Array.from(rollN).filter((v) => v > 0).sort((a, b) => a - b)[Math.floor(active.length / 2)] || 1;

  // Local peaks above threshold, strongest first, one per MIN_GAP.
  const peaks: { i: number; z: number }[] = [];
  for (let i = 1; i + 1 < nb; i++) {
    const z = (roll[i] - med) / (1.4826 * mad);
    // Unusual for THIS stream (z) AND a real jump in volume (≥2x the usual
    // message rate) — z alone flags ordinary noise on a quiet chat.
    if (z >= 3.5 && rollN[i] >= 2 * medN && roll[i] >= roll[i - 1] && roll[i] >= roll[i + 1]) peaks.push({ i, z });
  }
  peaks.sort((a, b) => b.z - a.z);
  const chosen: { i: number; z: number }[] = [];
  for (const p of peaks) {
    if (chosen.length >= maxSpikes) break;
    if (chosen.some((c) => Math.abs(c.i - p.i) * BIN_MS < MIN_GAP_MS)) continue;
    chosen.push(p);
  }

  const spikes = chosen.map(({ i, z }) => {
    const from = Math.max(0, i - WIN_BINS + 1);
    let l = 0, h = 0, s = 0;
    for (let b = from; b <= i; b++) { l += laugh[b]; h += hype[b]; s += shock[b]; }
    const n = Math.max(1, rollN[i]);
    const kind: ChatKind = Math.max(l, h, s) < n * 0.2 ? "busy" : l >= h && l >= s ? "laugh" : h >= s ? "hype" : "shock";
    const peakMs = (i + 1) * BIN_MS;
    const t0 = from * BIN_MS, t1 = peakMs;
    const freq = new Map<string, number>();
    for (const m of messages) {
      if (m.t < t0) continue;
      if (m.t > t1) break;
      const k = m.text.trim().toLowerCase().slice(0, 40);
      freq.set(k, (freq.get(k) ?? 0) + 1);
    }
    const sample = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
    return {
      t: Math.max(0, from * BIN_MS - REACTION_DELAY_MS + 2000), peak: peakMs,
      z: Math.round(z * 10) / 10, ratio: Math.round((rollN[i] / medN) * 10) / 10, kind, sample,
    };
  });
  return { messages: messages.length, spikes: spikes.sort((a, b) => a.t - b.t) };
}

/** Strongest spike whose moment falls inside [t0, t1] (chat reacting up to ~10 s after counts). */
export function chatSpikeIn(signal: ChatSignal | null | undefined, t0: number, t1: number): ChatSpike | null {
  let best: ChatSpike | null = null;
  for (const s of signal?.spikes ?? []) {
    if (s.peak < t0 + 2000 || s.t > t1 + 3000 || s.peak > t1 + 12_000) continue;
    if (!best || s.z > best.z) best = s;
  }
  return best;
}

/** 0–1 strength of a spike: z≈3 is noticeable, z≥10 is the stream's biggest moments. */
export const chatStrength = (s: ChatSpike | null) => (s ? Math.max(0, Math.min(1, (s.z - 2) / 8)) : 0);

export const CHAT_LABEL: Record<ChatKind, string> = { laugh: "chat laughing", hype: "chat hyped", shock: "chat shocked", busy: "chat exploded" };
