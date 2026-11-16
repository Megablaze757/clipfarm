import { openAsBlob } from "node:fs";
import { join } from "node:path";
import { ffmpeg, StageError } from "../lib/proc";
import { llm, parseJsonObject, transcribeViaWorker } from "../lib/worker";
import type { Segment, Transcript, Word } from "../lib/types";

/**
 * §6.1 ASR — Groq Whisper Large v3 Turbo, called through the Worker so the
 * runner never holds GROQ_SECRET (it's the same key PocketAthlete uses). Audio
 * is cut into 10-minute FLAC chunks with 2 s overlap (well under Groq's 25 MB
 * upload limit) and stitched at the seams.
 */
const CHUNK_S = 600;
const OVERLAP_S = 2;

interface GroqWord { word: string; start: number; end: number }
interface GroqSegment { id: number; start: number; end: number; text: string; avg_logprob?: number; no_speech_prob?: number }
interface GroqResponse { text: string; language?: string; words?: GroqWord[]; segments?: GroqSegment[] }

async function transcribeChunk(path: string, language: string | null): Promise<GroqResponse> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await transcribeViaWorker(await openAsBlob(path), language)
      .catch((e) => ({ ok: false, status: 0, headers: new Headers(), text: async () => String(e) }) as unknown as Response);
    if (r.ok) return (await r.json()) as GroqResponse;
    const detail = (await r.text()).slice(0, 300);
    if (/GROQ_SECRET/.test(detail)) throw new StageError("E_ASR_FAILED", "GROQ_SECRET is not set on the Worker, so speech can't be transcribed.");
    if (r.status === 401 || r.status === 403) throw new StageError("E_ASR_FAILED", `The Worker refused the runner (${r.status}): ${detail}`);
    if (r.status === 429 || r.status >= 500 || r.status === 0) {
      // R-10: exponential backoff, honouring Retry-After when Groq sends one.
      const after = Number(r.headers.get("retry-after"));
      const wait = Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 2000 * 2 ** attempt, 60_000);
      if (attempt < 4) { await new Promise((res) => setTimeout(res, wait)); continue; }
      if (r.status === 429) {
        throw new StageError("E_ASR_RATE_LIMITED", "The transcription service's daily limit was reached (Groq free tier). Retry later.", true);
      }
    }
    throw new StageError("E_ASR_FAILED", `Transcription failed (${r.status}): ${detail}`, r.status >= 500);
  }
  throw new StageError("E_ASR_FAILED", "Transcription failed.");
}

/** Whisper word timestamps carry no punctuation; the segment text does. Copy it across. */
export function alignPunctuation(words: GroqWord[], segments: GroqSegment[]): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
  const out = words.map((w) => w.word.trim());
  let wi = 0;
  for (const seg of segments) {
    const tokens = seg.text.trim().split(/\s+/).filter(Boolean);
    for (const tok of tokens) {
      const nt = norm(tok);
      if (!nt) continue;
      // Look a few words ahead for the matching word (Whisper sometimes splits differently).
      for (let k = wi; k < Math.min(words.length, wi + 4); k++) {
        if (norm(words[k].word) === nt) {
          out[k] = tok;
          wi = k + 1;
          break;
        }
      }
    }
  }
  return out;
}

export async function transcribe(audio: string, durationMs: number, dir: string, language: string | null): Promise<Transcript> {
  const totalS = durationMs / 1000;
  const chunks = Math.max(1, Math.ceil(totalS / CHUNK_S));
  const words: Word[] = [];
  const segments: Segment[] = [];
  let detected: string | null = null;

  for (let i = 0; i < chunks; i++) {
    const startS = i * CHUNK_S;
    const path = join(dir, `asr_${i}.flac`);
    await ffmpeg(["-ss", String(startS), "-t", String(CHUNK_S + OVERLAP_S), "-i", audio, "-ac", "1", "-ar", "16000", "-c:a", "flac", path]);
    const res = await transcribeChunk(path, language);
    detected ??= res.language ?? null;
    const offsetMs = startS * 1000;
    // Seam dedup: chunk i owns [start + 1 s, next start + 1 s).
    const lo = i === 0 ? -Infinity : offsetMs + (OVERLAP_S * 1000) / 2;
    const hi = i === chunks - 1 ? Infinity : (startS + CHUNK_S) * 1000 + (OVERLAP_S * 1000) / 2;
    const segs = res.segments ?? [];
    const texts = alignPunctuation(res.words ?? [], segs);
    (res.words ?? []).forEach((gw, k) => {
      const t0 = Math.round(gw.start * 1000) + offsetMs;
      const t1 = Math.max(t0 + 20, Math.round(gw.end * 1000) + offsetMs);
      if (t0 < lo || t0 >= hi) return;
      const text = texts[k].replace(/^\[.*\]$/, ""); // strip [Music] etc.
      if (!text) return;
      const seg = segs.find((s) => gw.start >= s.start - 0.05 && gw.start <= s.end + 0.05);
      // Groq reports no per-word confidence; derive it from the segment's log-prob (§6.1).
      const conf = seg?.avg_logprob != null ? Math.max(0, Math.min(1, Math.exp(seg.avg_logprob))) : 0.9;
      words.push({ w: text, t0, t1, conf: Math.round(conf * 100) / 100, speaker: "A" });
    });
    for (const s of segs) {
      const start = Math.round(s.start * 1000) + offsetMs;
      if (start < lo || start >= hi || (s.no_speech_prob ?? 0) > 0.8) continue;
      segments.push({ id: segments.length, start, end: Math.round(s.end * 1000) + offsetMs, text: s.text.trim() });
    }
  }
  words.sort((a, b) => a.t0 - b.t0);
  if (!words.length) throw new StageError("E_NO_SPEECH_DETECTED", "No speech was found in this source.");

  const speakers = await diarize(segments);
  for (const w of words) {
    const seg = segments.find((s) => w.t0 >= s.start - 50 && w.t0 <= s.end + 50);
    w.speaker = seg?.speaker ?? "A";
  }
  return { words, segments, speakers, language: detected };
}

/**
 * §6.2 text-based diarization through the shared AI ladder. Best effort: ~70 %
 * accurate on two speakers, used only as a boundary hint. Any failure falls
 * back to a single speaker.
 */
async function diarize(segments: Segment[]): Promise<string[]> {
  segments.forEach((s) => (s.speaker = "A"));
  if (segments.length < 4 || segments.length > 1500) return ["A"];
  const BATCH = 80;
  const seen = new Set<string>(["A"]);
  for (let i = 0; i < segments.length; i += BATCH) {
    const batch = segments.slice(i, i + BATCH);
    const prev = i > 0 ? `Previous segment ${i - 1} was speaker ${segments[i - 1].speaker}.\n` : "";
    const res = await llm(
      'You label speaker turns in a transcript. Speakers are "A", "B", "C"... in order of first appearance; keep labels consistent with any previous label given. Respond ONLY with JSON: {"labels":[{"i":number,"s":"A"}]} covering every segment index.',
      prev + batch.map((s, k) => `${i + k}: ${s.text}`).join("\n"),
      1200,
    );
    const parsed = res ? parseJsonObject<{ labels?: { i: number; s: string }[] }>(res.text) : null;
    if (!parsed?.labels) return ["A"]; // degrade gracefully, don't half-label
    for (const l of parsed.labels) {
      const seg = segments[l.i];
      if (seg && /^[A-F]$/.test(l.s)) { seg.speaker = l.s; seen.add(l.s); }
    }
  }
  return [...seen].sort();
}
