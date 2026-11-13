import { Word } from './asr'

export interface Candidate {
  t_in_ms: number
  t_out_ms: number
  score?: number
  subscores?: any
  features?: any
  rationale?: string
}

export function generateCandidates(words: Word[]): Candidate[] {
  if (!words || words.length === 0) return []
  const startMs = words[0].t0
  const endMs = words[words.length - 1].t1
  
  return [
    { t_in_ms: startMs, t_out_ms: Math.min(endMs, startMs + 30000) }
  ]
}
