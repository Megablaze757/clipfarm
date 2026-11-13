import React from 'react'
import Link from 'next/link'

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 glass-panel border-b border-white/10 px-6 py-3.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand Logo */}
        <Link href="/" className="flex items-center space-x-2.5 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-0.5 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
              </svg>
            </div>
          </div>
          <div>
            <span className="font-bold text-lg text-white tracking-tight">Clipper</span>
            <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-widest text-indigo-400 px-1.5 py-0.5 bg-indigo-500/10 border border-indigo-500/20 rounded-md">AI Studio</span>
          </div>
        </Link>

        {/* Nav Links */}
        <nav className="hidden md:flex items-center space-x-1 bg-slate-900/80 border border-slate-800 p-1 rounded-xl text-xs font-medium text-slate-300">
          <Link href="/projects" className="px-3.5 py-1.5 rounded-lg hover:text-white hover:bg-slate-800 transition-colors">
            Projects
          </Link>
          <Link href="/clips/cand_1" className="px-3.5 py-1.5 rounded-lg hover:text-white hover:bg-slate-800 transition-colors">
            Studio Editor
          </Link>
          <Link href="/settings/billing" className="px-3.5 py-1.5 rounded-lg hover:text-white hover:bg-slate-800 transition-colors">
            Usage & Billing
          </Link>
        </nav>

        {/* Right Actions */}
        <div className="flex items-center space-x-3">
          <div className="hidden sm:flex items-center space-x-2 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Groq ASR Online</span>
          </div>

          <Link href="/projects" className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-indigo-500/20 hover:shadow-indigo-500/30 transition-all flex items-center space-x-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            <span>+ New Project</span>
          </Link>
        </div>
      </div>
    </header>
  )
}
