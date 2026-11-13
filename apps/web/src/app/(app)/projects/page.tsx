import React from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function ProjectsPage() {
  const projects = [
    { id: 'prj_9x2', title: 'Tech Podcast Ep. 42', status: 'ready', clipsCount: 8, duration: '45m 12s', createdAt: '2026-11-13' },
    { id: 'prj_3a1', title: 'AI Engineering Keynote', status: 'transcribing', clipsCount: 0, duration: '1h 10m', createdAt: '2026-11-13' }
  ]

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Projects</h1>
          <p className="text-slate-400 text-sm">Upload media or paste YouTube/HLS video URLs</p>
        </div>
        <Button variant="primary">+ New Project</Button>
      </div>

      <div className="grid gap-4">
        {projects.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`}>
            <div className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-5 flex justify-between items-center transition-all cursor-pointer">
              <div>
                <h3 className="text-base font-semibold text-slate-100 mb-1">{p.title}</h3>
                <div className="flex items-center space-x-3 text-xs text-slate-400">
                  <span>Duration: {p.duration}</span>
                  <span>•</span>
                  <span>Created: {p.createdAt}</span>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <span className={`text-xs px-2.5 py-1 rounded-full uppercase tracking-wider font-bold ${p.status === 'ready' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-sky-500/10 text-sky-400'}`}>
                  {p.status}
                </span>
                <span className="text-slate-400 text-sm font-medium">{p.clipsCount} clips →</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
