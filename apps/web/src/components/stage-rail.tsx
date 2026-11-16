import React from 'react'

const STAGES = ['queued', 'transcoding', 'transcribing', 'candidates', 'scoring', 'ready']
const LABEL: Record<string, string> = { queued: 'Queued', transcoding: 'Uploading', transcribing: 'Transcribing', analyzing: 'Transcribing', candidates: 'Finding moments', scoring: 'Scoring', ready: 'Ready' }

export const StageRail: React.FC<{ status: string; progress?: number }> = ({ status, progress }) => {
  if (status === 'failed') return <span className="text-xs font-semibold text-rose-300 bg-rose-500/10 border border-rose-500/30 px-2.5 py-1 rounded-full">Failed</span>
  const current = STAGES.indexOf(status === 'analyzing' ? 'transcribing' : status)
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium" aria-label={`Status: ${LABEL[status] ?? status}`}>
      {STAGES.map((stage, idx) => (
        <span key={stage} className={`px-2 py-0.5 rounded-full ${idx === current ? 'bg-indigo-500 text-white font-semibold' : idx < current ? 'bg-slate-800 text-slate-300' : 'bg-slate-950 text-slate-600 border border-slate-800'}`}>
          {LABEL[stage]}{idx === current && status !== 'ready' && progress ? ` · ${Math.round(progress)}%` : ''}
        </span>
      ))}
    </div>
  )
}
