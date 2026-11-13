import React from 'react'
import { Button } from '@/components/ui/button'
import { TranscriptEditor } from '@/components/editor/transcript-editor'

export default async function ClipEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const mockWords = [
    { w: 'Welcome', t0: 1000, t1: 1400 },
    { w: 'to', t0: 1420, t1: 1550 },
    { w: 'the', t0: 1560, t1: 1700 },
    { w: 'Clipper', t0: 1710, t1: 2200 },
    { w: 'podcast.', t0: 2210, t1: 2800 },
  ]

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[500px]">
        <div className="aspect-[9/16] w-full bg-slate-950 rounded-xl flex items-center justify-center border border-slate-800 mb-4">
          <span className="text-slate-500 text-sm">9:16 Video Player ({id})</span>
        </div>
        <div className="w-full flex space-x-2">
          <Button variant="primary" className="w-full">Render & Export MP4</Button>
        </div>
      </div>

      <div className="lg:col-span-2 space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">Clip Review & Editor</h2>
          <p className="text-xs text-slate-400">Adjust trim handles, captions, and brand templates</p>
        </div>
        <TranscriptEditor words={mockWords} />
      </div>
    </div>
  )
}
