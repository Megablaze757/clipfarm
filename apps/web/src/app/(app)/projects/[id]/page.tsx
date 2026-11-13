import React from 'react'
import Link from 'next/link'
import { StageRail } from '@/components/stage-rail'
import { ClipCard } from '@/components/clip-card'

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const mockCandidates = [
    {
      id: 'cand_1',
      score: 92.4,
      t_in_ms: 184200,
      t_out_ms: 212800,
      rationale: 'Self-contained argument with strong curiosity hook in opening sentence.'
    },
    {
      id: 'cand_2',
      score: 87.1,
      t_in_ms: 450000,
      t_out_ms: 485000,
      rationale: 'High prosody variance & key insights on cloud container video processing.'
    }
  ]

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="mb-6">
        <div className="text-xs text-slate-400 mb-1">Projects / {id}</div>
        <h1 className="text-3xl font-bold text-white">Tech Podcast Ep. 42</h1>
        <StageRail status="ready" />
      </div>

      <div className="mb-8 flex justify-between items-center">
        <h2 className="text-xl font-bold text-slate-200">Candidate Shortlist ({mockCandidates.length})</h2>
        <div className="text-xs text-slate-400">Sorted by Standalone Watchability Score</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {mockCandidates.map((c) => (
          <Link key={c.id} href={`/clips/${c.id}`}>
            <ClipCard candidate={c} />
          </Link>
        ))}
      </div>
    </div>
  )
}
