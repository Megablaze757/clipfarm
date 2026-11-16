export interface Word {
  w: string;
  t0: number; // ms
  t1: number; // ms
  conf: number; // 0–1
  speaker: string;
}

export interface Segment {
  id: number;
  start: number; // ms
  end: number; // ms
  text: string;
  speaker?: string;
}

export interface Transcript {
  words: Word[];
  segments: Segment[];
  speakers: string[];
  language: string | null;
}

export interface Sentence {
  i0: number; // first word index
  i1: number; // last word index (inclusive)
  t0: number;
  t1: number;
}

export interface Subscores {
  hook: number;           // the first ~3 s stop the scroll
  self_contained: number; // makes sense to a stranger who never saw the rest
  complete: number;       // ends on a finished thought / punchline
  energy: number;         // vocal energy and pace
  structure: number;      // setup → payoff: a curiosity gap opened AND closed (Loewenstein)
  emotion: number;        // high-arousal emotion — amusement, awe, anger, anxiety (Berger & Milkman 2012)
  shareability: number;   // would someone send it to a friend: identity, practical value, a take to argue with
  reaction: number;       // laughter / applause / loud non-speech at or right after the payoff
  novelty: number;        // distinct from the other picks (MMR)
}

export interface Candidate {
  i0: number;
  i1: number;
  t_in_ms: number;
  t_out_ms: number;
  text: string;
  subscores: Subscores;
  score: number; // 0–100
  features: {
    badges: string[];
    signals: string[];
    unresolved?: string | null;
    title?: string;
    scorer?: "llm" | "heuristic";
    model?: string;
    thumb_key?: string;
    /** The editor's preview: clip ±60 s at 360p, starting at edit_offset_ms in source time. */
    edit_key?: string;
    edit_offset_ms?: number;
    edit_duration_ms?: number;
    /** story, hot_take, surprising_fact, funny, practical_tip, emotional, debate, quotable */
    category?: string;
    hook_line?: string;
    /** Found by the whole-transcript nomination pass (moments.ts). */
    nominated?: boolean;
    /** Multiplier on the composite (e.g. 0.85 = not reviewed by the AI judge). */
    score_factor?: number;
    /** Laughter/applause-like events inside or right after the clip. */
    reactions?: number;
  };
  rationale: string;
}

/** Audio energy (RMS) per 100 ms frame, 0–1. */
export type Envelope = Float32Array;

export const FRAME_MS = 100;
