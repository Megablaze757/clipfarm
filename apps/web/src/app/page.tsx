import React from 'react'
import Link from 'next/link'

export default function LandingPage() {
  return (
    <div className="relative overflow-hidden bg-slate-950 pb-24">
      {/* Glowing background ambient lights */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[400px] bg-gradient-to-tr from-indigo-600/20 via-purple-600/20 to-pink-600/10 blur-[120px] pointer-events-none -z-10 rounded-full"></div>

      <div className="max-w-7xl mx-auto px-6 pt-16 lg:pt-24 text-center relative">
        {/* Top Pill */}
        <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-semibold mb-8 backdrop-blur-md shadow-inner shadow-indigo-500/20">
          <span className="flex h-2 w-2 rounded-full bg-indigo-400 animate-ping" />
          <span>✨ Powered by Whisper Large v3 Turbo & Claude 3.5 Sonnet</span>
        </div>

        {/* Main Hero Headline */}
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight mb-8 leading-[1.1] max-w-5xl mx-auto">
          Turn Long-Form Videos Into <br className="hidden sm:inline" />
          <span className="gradient-text">Viral Short-Form Clips</span> in Seconds
        </h1>

        <p className="text-slate-400 text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed font-normal">
          Clipper automatically analyzes podcasts, streams, and webinars to identify high-watchability moments, applies speaker-aware 9:16 reframe, and generates karaoke captions with zero human editing.
        </p>

        {/* CTA Buttons & Quick Upload Mockup */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <Link href="/projects" className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white rounded-2xl text-base font-bold shadow-xl shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-[1.02] transition-all flex items-center justify-center space-x-2">
            <span>Start Auto-Clipping Free</span>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
          <Link href="/projects" className="w-full sm:w-auto px-8 py-4 glass-panel glass-panel-hover text-slate-200 rounded-2xl text-base font-semibold transition-all border border-slate-800 hover:border-slate-700">
            View Live Studio Demo
          </Link>
        </div>

        {/* Ingest Dropzone Preview Card */}
        <div className="max-w-4xl mx-auto glass-panel rounded-3xl p-8 border border-white/10 shadow-2xl text-left relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 blur-2xl pointer-events-none rounded-full"></div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4 flex items-center justify-between">
            <span>Paste Video URL or Drop File</span>
            <span className="text-indigo-400">Supports YouTube, Twitch, MP4, MOV, WAV</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input 
              type="text" 
              placeholder="https://www.youtube.com/watch?v=podcast-ep-42"
              defaultValue="https://youtube.com/watch?v=demo-podcast-stream"
              className="flex-1 bg-slate-950/80 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3.5 text-sm text-slate-200 placeholder-slate-600 outline-none transition-all font-mono"
            />
            <Link href="/projects" className="px-6 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm rounded-xl transition-colors whitespace-nowrap text-center">
              Generate Clips &rarr;
            </Link>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-800/80">
            <span>⚡ Processing Speed: ~45s per hour of video</span>
            <span>🔒 Zero Egress Cloudflare R2 Storage</span>
          </div>
        </div>
      </div>

      {/* Core Feature Highlights */}
      <div className="max-w-7xl mx-auto px-6 mt-28">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-extrabold text-white tracking-tight mb-4">
            Built for Standalone Watchability
          </h2>
          <p className="text-slate-400 text-base max-w-xl mx-auto">
            Unlike traditional trimming tools, Clipper optimizes for self-containedness so every clip makes total sense without context.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="glass-panel glass-panel-hover rounded-2xl p-6 border border-slate-800/80 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-lg">
              98
            </div>
            <h3 className="font-bold text-lg text-white">Explainable Scoring</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Every clip receives a 0–100 score evaluated on Hook Strength, Self-Containedness, Energy Delta, and Completeness.
            </p>
          </div>

          <div className="glass-panel glass-panel-hover rounded-2xl p-6 border border-slate-800/80 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center">
              🎬
            </div>
            <h3 className="font-bold text-lg text-white">Speaker Auto-Reframe</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Active face detection locks onto the speaker automatically or splits two-speaker interviews into stacked 9:16 layout.
            </p>
          </div>

          <div className="glass-panel glass-panel-hover rounded-2xl p-6 border border-slate-800/80 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center">
              💬
            </div>
            <h3 className="font-bold text-lg text-white">Karaoke Captions</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Word-level Groq Whisper Large v3 timestamps drive real-time yellow word highlighting and platform presets.
            </p>
          </div>

          <div className="glass-panel glass-panel-hover rounded-2xl p-6 border border-slate-800/80 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              ⚡
            </div>
            <h3 className="font-bold text-lg text-white">Zero-Touch Batch Queue</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Upload 60 hours of backlog at once and receive a sorted queue ready for single-click export.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
