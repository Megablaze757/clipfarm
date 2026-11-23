'use client'
import React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from './use-session'
import { useMe } from './use-me'

/** The mark: a frame with a cut through it — "a clip of something longer". */
export function Logo({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="#fb5a17" />
      <path d="M9.5 7.2v9.6l7.4-4.8z" fill="#0c0c0e" />
      <path d="M6.5 13.6 17.8 9.4" stroke="#fb5a17" strokeWidth="1.6" />
    </svg>
  )
}

const LINKS = [
  { href: '/projects', label: 'Projects' },
  { href: '/settings/brand', label: 'Brand' },
  { href: '/settings/team', label: 'Team' },
  { href: '/settings/billing', label: 'Billing' },
]

export function Navbar() {
  const session = useSession()
  const me = useMe()
  const router = useRouter()
  const path = usePathname() ?? ''
  const link = (href: string, label: string, extra = '', mobile = false) => {
    const active = path.startsWith(href)
    return (
      <Link key={href} href={href}
        className={`relative px-3 py-2 text-[13px] transition-colors ${active ? 'text-white' : 'text-slate-400 hover:text-slate-100'} ${extra}`}>
        {label}
        {active && <span className={`absolute left-3 right-3 h-px bg-indigo-500 ${mobile ? 'bottom-0' : '-bottom-[10px]'}`} />}
      </Link>
    )
  }
  return (
    <header className="sticky top-0 z-50 bg-slate-950/90 backdrop-blur border-b border-white/[0.06]">
      <div className="max-w-7xl mx-auto h-14 px-4 sm:px-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-6 min-w-0">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <Logo />
            <span className="font-display font-bold text-[15px] text-white tracking-tight">Clipper</span>
          </Link>
          <nav className="hidden sm:flex items-center">
            {LINKS.map((l) => link(l.href, l.label))}
            {me?.is_admin && link('/admin', 'Admin')}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {session ? (
            <>
              <Link href="/settings/account" className="hidden md:inline text-xs text-slate-400 hover:text-slate-200 truncate max-w-[180px]" title="Account">{session.user.email}</Link>
              <button
                onClick={async () => { await supabase.auth.signOut(); router.push('/') }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.06]"
              >Sign out</button>
            </>
          ) : session === null ? (
            <>
              <Link href="/login" className="px-3 py-1.5 rounded-lg text-[13px] text-slate-300 hover:text-white">Sign in</Link>
              <Link href="/login?mode=sign_up" className="px-3.5 py-1.5 rounded-lg text-[13px] font-semibold bg-white text-slate-950 hover:bg-slate-200">Start free</Link>
            </>
          ) : null}
        </div>
      </div>
      {(
        <nav className="sm:hidden flex items-center overflow-x-auto px-2 border-t border-white/[0.06]">
          {LINKS.map((l) => link(l.href, l.label, 'shrink-0', true))}
          {me?.is_admin && link('/admin', 'Admin', 'shrink-0', true)}
        </nav>
      )}
    </header>
  )
}
