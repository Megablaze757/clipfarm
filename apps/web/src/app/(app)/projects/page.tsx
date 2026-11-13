import React from 'react'
import Link from 'next/link'
import { StageRail } from '@/components/stage-rail'

export default function ProjectsPage() {
  const projects = [
    {
      id: 'proj_1',
      title: 'AI Engineering Podcast #42 — Building Video Pipelines',
      source_kind: 'YouTube',
      duration: '1h 14m',
      clipsCount: 12,
      status: 'ready',
      updatedAt: '2 hours ago',
      topScore: 94.2,
    },
    {
      id: 'proj_2',
      title: 'Founder Interview — Scaling Cloudflare Containers & R2',
      source_kind: 'File Upload',
      duration: '42m 10s',
      clipsCount: 8,
      status: 'ready',
      updatedAt: 'Yesterday',
      topScore: 89.5,
    },
    {
      id: 'proj_3',
      title: 'Weekly Tech Keynote & Product Announcement',
      source_kind: 'HLS Stream',
      duration: '2h 05m',
      clipsCount: 0,
      status: 'transcribing',
      updatedAt: '10 mins ago',
      topScore: 0,
    },
  ]

  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-10">
      {/* Dashboard Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Video Projects</h1>
          <p className="text-slate-400 text-sm mt-1">
            Manage long-form source videos, monitor AI transcription & candidate moment extraction.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button className="px-4 py-2.5 glass-panel glass-panel-hover text-slate-300 hover:text-white rounded-xl text-xs font-semibold border border-slate-800 transition-colors flex items-center space-x-2">
            <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <span>Batch Ingest</span>
          </button>
        </div>
      </div>

      {/* Quick New Project Upload Card */}
      <div className="glass-panel rounded-2xl p-6 border border-indigo-500/20 shadow-xl relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-indigo-500/10 blur-3xl pointer-events-none rounded-full"></div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white flex items-center space-x-2">
            <span>✨ Start New Auto-Clipping Project</span>
          </h2>
          <span className="text-xs text-indigo-400 font-mono">Whisper Large v3 Turbo</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <input
              type="text"
              placeholder="Paste YouTube, Twitch, or Direct Video URL..."
              className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 outline-none transition-all font-mono"
            />
          </div>
          <Link href="/projects/demo-project-1" className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-indigo-500/20 text-center flex items-center justify-center space-x-2">
            <span>Import & Extract Clips</span>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Projects List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white tracking-tight">Your Projects</h2>
          <div className="flex items-center space-x-2 text-xs font-medium text-slate-400 bg-slate-900 border border-slate-800 p-1 rounded-lg">
            <button className="px-3 py-1 bg-slate-800 text-white rounded-md font-semibold">All ({projects.length})</button>
            <button className="px-3 py-1 hover:text-slate-200 transition-colors">Ready (2)</button>
            <button className="px-3 py-1 hover:text-slate-200 transition-colors">Processing (1)</button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {projects.map((p) => (
            <div key={p.id} className="glass-panel glass-panel-hover rounded-2xl p-6 border border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="flex items-start space-x-4">
                <div className="w-24 h-16 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-center text-slate-600 font-mono text-[10px] shrink-0 relative overflow-hidden">
                  <span className="absolute bottom-1 right-1 bg-slate-950/90 text-slate-300 px-1.5 py-0.5 rounded text-[9px] font-semibold">{p.duration}</span>
                  <span>POSTER</span>
                </div>
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-md">{p.source_kind}</span>
                    <span className="text-xs text-slate-500">&bull; Updated {p.updatedAt}</span>
                  </div>
                  <h3 className="text-base font-bold text-white hover:text-indigo-400 transition-colors cursor-pointer">
                    {p.title}
                  </h3>
                  <div className="mt-2">
                    <StageRail status={p.status} />
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-6 border-t md:border-t-0 border-slate-800/80 pt-4 md:pt-0 justify-between md:justify-end">
                {p.clipsCount > 0 ? (
                  <div className="text-right">
                    <div className="text-sm font-extrabold text-indigo-400">{p.clipsCount} Candidates</div>
                    <div className="text-[11px] text-slate-400">Top Score: <span className="text-emerald-400 font-bold">{p.topScore}/100</span></div>
                  </div>
                ) : (
                  <div className="text-right text-xs text-slate-500 font-mono animate-pulse">
                    Analyzing speech & boundaries...
                  </div>
                )}

                <Link 
                  href={`/projects/${p.id}`} 
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl text-xs font-semibold transition-colors border border-slate-700/60 shadow-sm flex items-center space-x-1"
                >
                  <span>Open Shortlist</span>
                  <span>&rarr;</span>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
