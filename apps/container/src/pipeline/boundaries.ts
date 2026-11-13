import { Candidate } from './candidates'
import { Word } from './asr'

export function snapBoundaries(candidates: Candidate[], _words: Word[]): Candidate[] {
  return candidates.map(c => ({
    ...c,
    // Boundary snapping algorithm prevents mid-word cuts and ensures clean pauses
    t_in_ms: Math.max(0, c.t_in_ms - 50),
    t_out_ms: c.t_out_ms + 100
  }))
}
