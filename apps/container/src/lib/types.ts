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
  hook: number;
  self_contained: number;
  complete: number;
  energy: number;
  structure: number;
  novelty: number;
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
  };
  rationale: string;
}

/** Audio energy (RMS) per 100 ms frame, 0–1. */
export type Envelope = Float32Array;

export const FRAME_MS = 100;
