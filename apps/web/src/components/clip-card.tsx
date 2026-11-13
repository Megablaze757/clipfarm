import React from 'react'
import { formatDuration } from '@/lib/tokens'

interface ClipCardProps {
  candidate: {
    id: string
    score: number
    t_in_ms: number
    t_out_ms: number
    rationale?: string
    proxy_uri?: string
  }
  onSelect?: () => void
}

export const ClipCard: React.FC<ClipCardProps> = ({ candidate, onSelect }) => {
  return (
    <div
      onClick={onSelect}
      className="bg-slate-900 border border-slate-800 hover:border-sky-500 rounded-xl p-4 cursor-pointer transition-all shadow-md hover:shadow-sky-500/10"
    >
      <div className="aspect-[9/16] bg-slate-950 rounded-lg mb-3 flex items-center justify-center border border-slate-800/80 relative overflow-hidden">
        <div className="absolute top-2 right-2 bg-sky-500/90 text-white text-xs font-bold px-2 py-0.5 rounded-full">
          Score: {candidate.score}
        </div>
        <span className="text-slate-600 text-xs">9:16 Preview</span>
      </div>
      <div className="flex justify-between items-center text-xs text-slate-400 mb-2">
        <span>Duration: {formatDuration(candidate.t_out_ms - candidate.t_in_ms)}</span>
        <span>{formatDuration(candidate.t_in_ms)} - {formatDuration(candidate.t_out_ms)}</span>
      </div>
      <p className="text-slate-300 text-xs line-clamp-2 italic">
        "{candidate.rationale || 'High watchability segment'}"
      </p>
    </div>
  )
}
