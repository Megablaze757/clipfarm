export interface Word {
  w: string
  t0: number
  t1: number
  conf: number
  speaker: string
}

export interface Transcript {
  words: Word[]
  segments: any[]
  speakers: string[]
}

export async function runASR(_mezzaninePath: string): Promise<Transcript> {
  // Groq Whisper Large v3 Turbo ASR Processing Mock / Contract
  const mockWords: Word[] = [
    { w: 'Welcome', t0: 1000, t1: 1400, conf: 0.99, speaker: 'A' },
    { w: 'to', t0: 1420, t1: 1550, conf: 0.99, speaker: 'A' },
    { w: 'the', t0: 1560, t1: 1700, conf: 0.99, speaker: 'A' },
    { w: 'Clipper', t0: 1710, t1: 2200, conf: 0.99, speaker: 'A' },
    { w: 'podcast', t0: 2210, t1: 2800, conf: 0.98, speaker: 'A' },
    { w: 'show.', t0: 2810, t1: 3200, conf: 0.99, speaker: 'A' },
    { w: 'Today', t0: 3800, t1: 4200, conf: 0.99, speaker: 'A' },
    { w: 'we', t0: 4210, t1: 4350, conf: 0.99, speaker: 'A' },
    { w: 'are', t0: 4360, t1: 4500, conf: 0.99, speaker: 'A' },
    { w: 'discussing', t0: 4510, t1: 5000, conf: 0.99, speaker: 'A' },
    { w: 'AI', t0: 5010, t1: 5300, conf: 0.99, speaker: 'A' },
    { w: 'video', t0: 5310, t1: 5700, conf: 0.99, speaker: 'A' },
    { w: 'automation.', t0: 5710, t1: 6400, conf: 0.99, speaker: 'A' }
  ]

  return {
    words: mockWords,
    segments: [{ id: 1, start: 1000, end: 6400, text: 'Welcome to the Clipper podcast show.' }],
    speakers: ['A']
  }
}
