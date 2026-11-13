import React from 'react'

interface Word {
  w: string
  t0: number
  t1: number
  speaker?: string
}

interface TranscriptEditorProps {
  words: Word[]
  onWordEdit?: (idx: number, newText: string) => void
}

export const TranscriptEditor: React.FC<TranscriptEditorProps> = ({ words }) => {
  return (
    <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 leading-relaxed font-sans text-sm">
      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Transcript Timeline</h4>
      <div className="flex flex-wrap gap-1.5">
        {words.map((word, idx) => (
          <span
            key={idx}
            className="px-1.5 py-0.5 rounded hover:bg-sky-500/20 hover:text-sky-300 cursor-pointer text-slate-200 transition-colors"
            title={`${word.t0}ms - ${word.t1}ms`}
          >
            {word.w}
          </span>
        ))}
      </div>
    </div>
  )
}
