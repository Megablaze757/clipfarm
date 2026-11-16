'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/** Current Supabase session; `undefined` while loading. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  return session
}

/** Sends signed-out visitors to /login and back afterwards. */
export function useRequireSession(): Session | null | undefined {
  const session = useSession()
  const router = useRouter()
  useEffect(() => {
    if (session === null) {
      const next = typeof window !== 'undefined' ? window.location.pathname.replace(process.env.NEXT_PUBLIC_BASE_PATH || '', '') + window.location.search : '/projects'
      router.replace(`/login?next=${encodeURIComponent(next)}`)
    }
  }, [session, router])
  return session
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="max-w-7xl mx-auto px-6 py-24 text-center text-sm text-slate-400 animate-pulse">{label}</div>
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 flex items-center justify-between gap-4">
      <span>{message}</span>
      {onRetry && <button onClick={onRetry} className="text-xs font-semibold underline">Retry</button>}
    </div>
  )
}
