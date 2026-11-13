import { Candidate } from './candidates'
import { Word } from './asr'

export async function scoreCandidates(candidates: Candidate[], _words: Word[]): Promise<Candidate[]> {
  return candidates.map(c => ({
    ...c,
    score: 88.5,
    subscores: {
      hook: 0.92,
      self_containedness: 0.89,
      completeness: 0.85,
      energy: 0.80,
      structure: 0.88,
      novelty: 0.90
    },
    features: {
      has_question: true,
      speaker_turns: 1
    },
    rationale: 'Strong opening hook with standalone topic introducing AI video automation.'
  }))
}
