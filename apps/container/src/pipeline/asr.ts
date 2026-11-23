import { openAsBlob } from "node:fs";
import { join } from "node:path";
import { ffmpeg, run, StageError } from "../lib/proc";
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
/** Chunks transcribed at once (Groq allows ~20 requests/min on the free tier). */
const ASR_PARALLEL = 3;

/** Runs task(0..count-1) with at most `limit` in flight. */
export async function pool(count: number, limit: number, task: (i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => { while (next < count) { const i = next++; await task(i); } };
  await Promise.all(Array.from({ length: Math.min(limit, count) }, lane));
}

interface GroqWord { word: string; start: number; end: number }
interface GroqSegment { id: number; start: number; end: number; text: string; avg_logprob?: number; no_speech_prob?: number }
interface GroqResponse { text: string; language?: string; words?: GroqWord[]; segments?: GroqSegment[] }

/**
 * Built-in Whisper on the runner's own CPU (scripts/whisper_local.py, via
 * faster-whisper). Free and unlimited, slower than Groq. Available when the
 * runner set WHISPER_PYTHON (the GitHub workflow installs it); the Cloudflare
 * Container doesn't have it and simply waits for Groq instead.
 */
const WHISPER_PYTHON = () => process.env.WHISPER_PYTHON || "";
const localAvailable = () => !!WHISPER_PYTHON();
let usedLocal = 0;
export const localChunksUsed = () => usedLocal;

/**
 * Installs faster-whisper the first time it's needed, so jobs that never hit
 * Groq's limit don't pay the ~30 s install. Model weights download on first
 * use too (~150 MB for "base").
 */
let installed: Promise<void> | null = null;
function ensureLocalWhisper(): Promise<void> {
  installed ??= (async () => {
    try {
      await run(WHISPER_PYTHON(), ["-c", "import faster_whisper"], { timeoutMs: 60_000 });
    } catch {
      console.log("installing faster-whisper for the built-in transcription fallback…");
      await run(WHISPER_PYTHON(), ["-m", "pip", "install", "--quiet", "faster-whisper>=1.1,<2"], { timeoutMs: 10 * 60 * 1000 });
    }
  })();
  return installed;
}

async function transcribeLocally(path: string, language: string | null): Promise<GroqResponse> {
  await ensureLocalWhisper();
  const script = join(__dirname, "..", "..", "scripts", "whisper_local.py");
  const { stdout } = await run(WHISPER_PYTHON(), [script, path, language ?? "auto"], { timeoutMs: 90 * 60 * 1000 });
  usedLocal++;
  const parsed = JSON.parse(stdout) as GroqResponse;
  return { ...parsed, text: (parsed.segments ?? []).map((s) => s.text).join(" ") };
}

/** Longest we'll sit waiting on Groq's hourly allowance when there's no local fallback. */
const MAX_GROQ_WAIT_MS = 65 * 60 * 1000;
/** A Retry-After longer than this switches straight to local Whisper (when available). */
const SWITCH_TO_LOCAL_AFTER_MS = 30 * 1000;

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Set once Groq rejects the key: the rest of the job skips straight to local Whisper. */
let groqUnusable = false;

/**
 * Built-in Whisper is the default transcriber (reliable, no key, no quota);
 * Groq is opt-in with CLIPPER_ASR=groq on the runner.
 */
export const groqPreferred = () => process.env.CLIPPER_ASR === "groq" || !localAvailable();

async function transcribeChunk(path: string, language: string | null): Promise<GroqResponse> {
  if ((groqUnusable || !groqPreferred()) && localAvailable()) return transcribeLocally(path, language);
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    const r = await transcribeViaWorker(await openAsBlob(path), language)
      .catch((e) => ({ ok: false, status: 0, headers: new Headers(), text: async () => String(e) }) as unknown as Response);
    if (r.ok) return (await r.json()) as GroqResponse;
    const detail = (await r.text()).slice(0, 300);
    // Groq's own "bad key" comes back through the Worker as 401 too — tell it
    // apart from the Worker refusing the runner, and fall back instead of failing.
    if (/GROQ_SECRET|invalid_api_key|Invalid API Key/i.test(detail)) {
      groqUnusable = true;
      console.warn(`Groq unusable (${detail.slice(0, 120)}) — using built-in Whisper`);
      if (localAvailable()) return transcribeLocally(path, language);
      throw new StageError("E_ASR_FAILED", "Groq rejected the API key (GROQ_SECRET on the Worker). Replace the key at console.groq.com.");
    }
    if (r.status === 401 || r.status === 403) throw new StageError("E_ASR_FAILED", `The Worker refused the runner (${r.status}): ${detail}`);

    if (r.status === 429) {
      // Groq's free tier caps audio per hour/day. Its Retry-After says when the
      // allowance comes back: a short wait is cheaper than local Whisper, a
      // long one isn't.
      const after = Number(r.headers.get("retry-after"));
      const wait = Number.isFinite(after) && after > 0 ? after * 1000 : Math.min(5000 * 2 ** attempt, 5 * 60 * 1000);
      if (localAvailable() && (wait > SWITCH_TO_LOCAL_AFTER_MS || attempt >= 3)) {
        console.log(`Groq rate-limited (retry in ${Math.round(wait / 1000)}s) — using built-in Whisper for this chunk`);
        return transcribeLocally(path, language);
      }
      if (waited + wait > MAX_GROQ_WAIT_MS) {
        throw new StageError("E_ASR_RATE_LIMITED", "The transcription service's free limit was reached. Retry in a while.", true);
      }
      console.log(`Groq rate-limited — waiting ${Math.round(wait / 1000)}s for the allowance to reset`);
      await sleep(wait);
      waited += wait;
      continue;
    }

    if (r.status >= 500 || r.status === 0) {
      if (attempt < 4) { await sleep(2000 * 2 ** attempt); continue; }
      if (localAvailable()) return transcribeLocally(path, language);
    }
    throw new StageError("E_ASR_FAILED", `Transcription failed (${r.status}): ${detail}`, r.status >= 500);
  }
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

  // Three chunks in flight at once: a 1-hour source is 6 chunks, so this is
  // ~2 Groq round-trips instead of 6. Results are merged in order below.
  const results: GroqResponse[] = new Array(chunks);
  await pool(chunks, ASR_PARALLEL, async (i) => {
    const path = join(dir, `asr_${i}.flac`);
    await ffmpeg(["-ss", String(i * CHUNK_S), "-t", String(CHUNK_S + OVERLAP_S), "-i", audio, "-ac", "1", "-ar", "16000", "-c:a", "flac", path]);
    results[i] = await transcribeChunk(path, language);
  });

  for (let i = 0; i < chunks; i++) {
    const startS = i * CHUNK_S;
    const res = results[i];
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
  // Batches run 4 at a time. Each batch also labels the last OVERLAP segments
  // of the batch before it; afterwards those shared segments tell us how to
  // map each batch's "A/B" onto the previous batch's, so labels stay
  // consistent across the whole source even though batches ran in parallel.
  const BATCH = 100;
  const OVERLAP = 8;
  const starts: number[] = [];
  for (let i = 0; i < segments.length; i += BATCH) starts.push(i);
  const labels: (Map<number, string> | null)[] = new Array(starts.length).fill(null);
  await pool(starts.length, 4, async (b) => {
    const from = Math.max(0, starts[b] - (b > 0 ? OVERLAP : 0));
    const to = Math.min(segments.length, starts[b] + BATCH);
    const res = await llm(
      'You label speaker turns in a transcript. Speakers are "A", "B", "C"... in order of first appearance within this excerpt. Respond ONLY with JSON: {"labels":[{"i":number,"s":"A"}]} covering every segment index.',
      segments.slice(from, to).map((s, k) => `${from + k}: ${s.text}`).join("\n"),
      1400,
    );
    const parsed = res ? parseJsonObject<{ labels?: { i: number; s: string }[] }>(res.text) : null;
    if (!parsed?.labels) return;
    labels[b] = new Map(parsed.labels.filter((l) => /^[A-F]$/.test(l.s) && l.i >= from && l.i < to).map((l) => [l.i, l.s]));
  });
  if (labels.some((m) => !m)) return ["A"]; // degrade gracefully, don't half-label

  // Stitch: map each batch's labels onto the previous (already stitched) batch.
  const seen = new Set<string>();
  for (let b = 0; b < starts.length; b++) {
    const mine = labels[b]!;
    const rename = new Map<string, string>();
    if (b > 0) {
      const votes = new Map<string, Map<string, number>>();
      for (let i = starts[b] - OVERLAP; i < starts[b]; i++) {
        const theirs = segments[i]?.speaker, ours = mine.get(i);
        if (!theirs || !ours) continue;
        const v = votes.get(ours) ?? new Map<string, number>();
        v.set(theirs, (v.get(theirs) ?? 0) + 1);
        votes.set(ours, v);
      }
      for (const [ours, v] of votes) rename.set(ours, [...v.entries()].sort((x, y) => y[1] - x[1])[0][0]);
    }
    for (let i = starts[b]; i < Math.min(segments.length, starts[b] + BATCH); i++) {
      const raw = mine.get(i);
      if (!raw) continue;
      segments[i].speaker = rename.get(raw) ?? raw;
      seen.add(segments[i].speaker!);
    }
  }
  return seen.size ? [...seen].sort() : ["A"];
}
