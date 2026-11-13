import React from 'react'
import Link from 'next/link'

export function generateStaticParams() {
  return [{ id: 'cand_1' }, { id: 'cand_2' }]
}

export const dynamicParams = false;

export default async function ClipDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <div className="max-w-6xl mx-auto px-6 py-10 text-slate-100">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/projects" className="text-xs text-indigo-400 hover:underline mb-1 inline-block">
            &larr; Back to Projects
          </Link>
          <h1 className="text-2xl font-bold">Editing Clip #{id}</h1>
        </div>
        <button className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-semibold transition-colors">
          Export Clip MP4
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col items-center justify-center min-h-[400px]">
          <div className="w-48 aspect-[9/16] bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-center text-slate-500 font-mono text-xs text-center p-4">
            9:16 Video Player & Caption Overlay Preview
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
          <h2 className="text-lg font-bold border-b border-slate-800 pb-2">Clip Controls</h2>
          <div>
            <label className="text-xs text-slate-400 font-semibold block mb-1">Aspect Ratio</label>
            <select className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm text-slate-200">
              <option>9:16 Vertical (TikTok/Reels/Shorts)</option>
              <option>1:1 Square (Instagram)</option>
              <option>16:9 Landscape</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 font-semibold block mb-1">Caption Karaoke Style</label>
            <select className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm text-slate-200">
              <option>Yellow Word Highlight</option>
              <option>White Bold Bottom</option>
              <option>Boxed Background</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
