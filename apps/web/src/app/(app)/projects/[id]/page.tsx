import React from 'react'
import Link from 'next/link'
import { StageRail } from '@/components/stage-rail'

export function generateStaticParams() {
  return [{ id: 'demo-project-1' }, { id: 'proj_1' }, { id: 'proj_2' }]
}

export const dynamicParams = false;

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const mockCandidates = [
    {
      id: 'cand_1',
      score: 94.2,
      subscores: { hook: 98, selfContained: 92, energy: 95, completeness: 92 },
      t_in: '03:04',
      t_out: '03:32',
      duration: '28s',
      rationale: 'Interrogative opening hook ("The secret to high-throughput video processing...") with high pitch variance and strong conclusion.',
      badges: ['⚡ Interrogative Hook', '🧠 Self-Contained', '🔥 High Energy']
    },
    {
      id: 'cand_2',
      score: 89.5,
      subscores: { hook: 91, selfContained: 90, energy: 88, completeness: 89 },
      t_in: '07:15',
      t_out: '07:50',
      duration: '35s',
      rationale: 'Key architectural breakdown on zero-egress Cloudflare R2 vs S3 storage cost comparison.',
      badges: ['💡 Technical Breakdown', '📊 Data Driven']
    },
    {
      id: 'cand_3',
      score: 84.1,
      subscores: { hook: 86, selfContained: 82, energy: 85, completeness: 83 },
      t_in: '14:20',
      t_out: '15:02',
      duration: '42s',
      rationale: 'Humorous debate segment on developer productivity tools & local LLMs.',
      badges: ['😂 High Laughter', '💬 Active Discussion']
    }
  ]

  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-8">
      {/* Header Breadcrumb & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <div className="flex items-center space-x-2 text-xs text-slate-400 mb-2">
            <Link href="/projects" className="hover:text-indigo-400 transition-colors">Projects</Link>
            <span>/</span>
            <span className="text-slate-200 font-mono">{id}</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">AI Engineering Podcast #42</h1>
          <div className="flex items-center space-x-4 mt-2 text-xs text-slate-400">
            <span>Source: 1h 14m</span>
            <span>&bull;</span>
            <span>Groq Whisper v3 (98.4% confidence)</span>
            <span>&bull;</span>
            <span>2 Speakers Detected</span>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-500/20">
            Export All Clips (3)
          </button>
        </div>
      </div>

      {/* Status Rail */}
      <div className="glass-panel rounded-2xl p-4 border border-slate-800 flex items-center justify-between text-xs">
        <div className="flex items-center space-x-3">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="font-bold text-white uppercase tracking-wider">Processing Complete</span>
        </div>
        <StageRail status="ready" />
      </div>

      {/* Shortlist Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white tracking-tight">Scored Shortlist Candidates ({mockCandidates.length})</h2>
          <span className="text-xs text-slate-400 font-mono">Optimized for Standalone Watchability</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {mockCandidates.map((c) => (
            <div key={c.id} className="glass-panel glass-panel-hover rounded-2xl p-6 border border-slate-800/80 flex flex-col justify-between space-y-6 relative group">
              <div>
                {/* Thumbnail Frame & Score Dial */}
                <div className="relative w-full aspect-[9/16] max-h-64 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex items-center justify-center mb-4 group-hover:border-indigo-500/40 transition-colors">
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent z-10"></div>
                  <div className="text-center space-y-1 z-0">
                    <div className="w-12 h-12 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-400">
                      <svg className="w-6 h-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500 block">Preview 9:16 Crop</span>
                  </div>
                  <div className="absolute top-3 right-3 z-20 bg-slate-900/90 backdrop-blur-md border border-emerald-500/30 text-emerald-400 px-2.5 py-1 rounded-full text-xs font-bold shadow-lg">
                    ★ {c.score}/100
                  </div>
                  <div className="absolute bottom-3 left-3 z-20 text-[10px] font-mono text-slate-300 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800">
                    {c.t_in} &rarr; {c.t_out} ({c.duration})
                  </div>
                </div>

                {/* Badges */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {c.badges.map((b, i) => (
                    <span key={i} className="text-[10px] font-semibold text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md">
                      {b}
                    </span>
                  ))}
                </div>

                {/* Rationale */}
                <h3 className="text-sm font-bold text-white mb-2 leading-snug">
                  {c.rationale}
                </h3>
              </div>

              {/* Actions */}
              <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between gap-3">
                <Link 
                  href={`/clips/${c.id}`} 
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-colors text-center shadow-md shadow-indigo-500/10"
                >
                  Open Studio Editor &rarr;
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
