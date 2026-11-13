import React from 'react'

interface StageRailProps {
  status: string
}

const STAGES = ['queued', 'transcoding', 'transcribing', 'candidates', 'scoring', 'ready']

export const StageRail: React.FC<StageRailProps> = ({ status }) => {
  const currentIndex = STAGES.indexOf(status)

  return (
    <div className="flex items-center space-x-2 my-4 text-xs font-medium">
      {STAGES.map((stage, idx) => {
        const isDone = idx < currentIndex
        const isCurrent = idx === currentIndex
        return (
          <div key={stage} className="flex items-center space-x-2">
            <span className={`px-2.5 py-1 rounded-full capitalize ${' '}
              ${isCurrent ? 'bg-sky-500 text-white font-semibold' : ''}${' '}
              ${isDone ? 'bg-slate-800 text-slate-300' : ''}${' '}
              ${!isDone && !isCurrent ? 'bg-slate-950 text-slate-600' : ''}
            `}>
              {stage}
            </span>
            {idx < STAGES.length - 1 && <span className="text-slate-700">→</span>}
          </div>
        )
      })}
    </div>
  )
}
