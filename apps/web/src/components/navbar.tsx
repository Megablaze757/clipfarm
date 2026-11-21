'use client'
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from './use-session'
import { useMe } from './use-me'

export function Navbar() {
  const session = useSession()
  const me = useMe()
  const router = useRouter()
  return (
    <header className="sticky top-0 z-50 glass-panel border-b border-white/10 px-4 sm:px-6 py-3.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center space-x-2.5 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-0.5 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
              </svg>
            </div>
          </div>
          <span className="font-bold text-lg text-white tracking-tight">Clipper</span>
        </Link>

        <nav className="flex items-center space-x-1 bg-slate-900/80 border border-slate-800 p-1 rounded-xl text-xs font-medium text-slate-300">
          <Link href="/projects" className="px-3 py-1.5 rounded-lg hover:text-white hover:bg-slate-800 transition-colors">Projects</Link>
          <Link href="/settings/brand" className="px-3 py-1.5 rounded-lg hover:text-white hover:bg-slate-800 transition-colors">Brand</Link>
          <Link href="/settings/team" className="px-3 py-1.5 rounded-lg hover:text-white hover:bg-slate-800 transition-colors">Team</Link>
          <Link href="/settings/billing" className="px-3 py-1.5 rounded-lg hover:text-white hover:bg-slate-800 transition-colors">Billing</Link>
          {me?.is_admin && <Link href="/admin" className="px-3 py-1.5 rounded-lg text-amber-200 hover:text-white hover:bg-slate-800 transition-colors">Admin</Link>}
        </nav>

        <div className="flex items-center space-x-3">
          {session ? (
            <>
              <Link href="/settings/account" className="hidden md:inline text-[11px] text-slate-400 hover:text-slate-200 truncate max-w-[180px]" title="Account">{session.user.email}</Link>
              <button
                onClick={async () => { await supabase.auth.signOut(); router.push('/') }}
                className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-700 text-slate-300 hover:bg-slate-800"
              >Sign out</button>
            </>
          ) : session === null ? (
            <Link href="/login" className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl text-xs font-semibold">Sign in</Link>
          ) : null}
        </div>
      </div>
    </header>
  )
}
