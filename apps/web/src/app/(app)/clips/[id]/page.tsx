import React from 'react'
import Link from 'next/link'

export function generateStaticParams() {
  return [{ id: 'cand_1' }, { id: 'cand_2' }, { id: 'cand_3' }, { id: 'demo' }]
}

export const dynamicParams = false;

export default async function ClipStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Studio Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div className="flex items-center space-x-4">
          <Link href="/projects" className="px-3 py-1.5 glass-panel glass-panel-hover text-xs font-semibold text-slate-300 rounded-lg border border-slate-800 flex items-center space-x-1.5">
            <span>&larr; Projects</span>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white flex items-center space-x-2">
              <span>Clip Studio Editor</span>
              <span className="text-xs font-mono font-normal text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">#{id}</span>
            </h1>
            <p className="text-xs text-slate-400">Non-destructive trim, face-aware reframe & karaoke captions</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-500/20 flex items-center space-x-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/></svg>
            <span>Export MP4 Video</span>
          </button>
        </div>
      </div>

      {/* Main Studio Dual Pane */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Studio Preview Canvas (8 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="glass-panel rounded-3xl p-6 border border-slate-800 flex flex-col items-center justify-center min-h-[500px] relative overflow-hidden">
            {/* Phone Aspect Ratio Mockup */}
            <div className="w-64 aspect-[9/16] bg-slate-950 rounded-2xl border-2 border-slate-800 shadow-2xl relative overflow-hidden flex flex-col justify-between p-4">
              <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono z-10">
                <span>HD 1080x1920</span>
                <span className="text-emerald-400 font-bold">92/100</span>
              </div>

              {/* Center Speaker Graphic */}
              <div className="my-auto text-center space-y-2 z-10">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 mx-auto flex items-center justify-center text-white text-xl font-bold border-2 border-white/20 shadow-xl">
                  🎙️
                </div>
                <div className="text-[11px] font-semibold text-slate-300 bg-slate-900/80 px-2 py-1 rounded-full border border-slate-800 inline-block">
                  Active Speaker Locked
                </div>
              </div>

              {/* Karaoke Captions Overlay Mockup */}
              <div className="bg-slate-900/90 backdrop-blur-md rounded-xl p-3 border border-white/10 text-center z-10 shadow-xl">
                <p className="text-xs font-extrabold tracking-wide text-white leading-relaxed">
                  "The secret to <span className="bg-amber-400 text-slate-950 px-1 py-0.5 rounded font-black">high-throughput</span> video processing is selecting the right bounds!"
                </p>
              </div>
            </div>

            {/* Audio Waveform & Trim Handle Bar */}
            <div className="w-full max-w-md mt-6 bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2">
              <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                <span>Trim In: 03:04.2</span>
                <span className="text-indigo-400 font-bold">28.0s Clip</span>
                <span>Trim Out: 03:32.2</span>
              </div>
              <div className="h-8 bg-slate-900 rounded-lg border border-slate-800 flex items-center px-2 relative overflow-hidden">
                <div className="absolute inset-y-0 left-12 right-12 bg-indigo-500/20 border-x-2 border-indigo-500"></div>
                <div className="w-full flex items-center justify-between text-slate-700 text-[10px] font-mono z-10 pointer-events-none">
                  <span>||||||||||||||||||||||||||||||||||||||||||||||||||||</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Studio Controls Sidebar (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="glass-panel rounded-3xl p-6 border border-slate-800 space-y-6">
            <div className="flex border-b border-slate-800 pb-3 gap-4 text-xs font-bold text-slate-300">
              <button className="text-indigo-400 border-b-2 border-indigo-500 pb-1">1. Captions & Transcript</button>
              <button className="hover:text-white transition-colors pb-1">2. Reframe</button>
              <button className="hover:text-white transition-colors pb-1">3. Export</button>
            </div>

            {/* Word-level Transcript Editor */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                Word-Level Transcript (Groq Whisper v3)
              </label>
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-xs leading-relaxed font-sans text-slate-300 space-y-2 max-h-48 overflow-y-auto">
                <p>
                  <span className="bg-indigo-500/20 text-indigo-300 px-1 py-0.5 rounded cursor-pointer hover:bg-indigo-500/30">The</span>{" "}
                  <span className="bg-indigo-500/20 text-indigo-300 px-1 py-0.5 rounded cursor-pointer hover:bg-indigo-500/30">secret</span>{" "}
                  <span className="bg-indigo-500/20 text-indigo-300 px-1 py-0.5 rounded cursor-pointer hover:bg-indigo-500/30">to</span>{" "}
                  <span className="bg-amber-400/20 text-amber-300 font-bold px-1 py-0.5 rounded cursor-pointer">high-throughput</span>{" "}
                  <span>video processing is selecting the right bounds without cutting off sentences!</span>
                </p>
              </div>
              <p className="text-[11px] text-slate-500">Click any word to adjust boundary snapping or correct typo.</p>
            </div>

            {/* Preset Customization Controls */}
            <div className="space-y-4 border-t border-slate-800/80 pt-4">
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1.5">Aspect Ratio Preset</label>
                <select className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 outline-none focus:border-indigo-500">
                  <option>9:16 Vertical (TikTok, Shorts, Reels)</option>
                  <option>1:1 Square (Instagram Feed)</option>
                  <option>16:9 Original Landscape</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1.5">Caption Style</label>
                <select className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 outline-none focus:border-indigo-500">
                  <option>Karaoke Yellow Highlight (Recommended)</option>
                  <option>Cyberpunk Neon Box</option>
                  <option>Classic Subtitles</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
