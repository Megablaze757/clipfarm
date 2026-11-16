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

/**
 * GUEST MODE (testing): signed-out visitors use the app as a shared Guest
 * workspace instead of being sent to /login. The Worker decides whether guest
 * mode is allowed; if it's switched off, API calls return 401 and we send the
 * visitor to sign in then.
 */
export interface Guest { guest: true }
export const GUEST: Guest = { guest: true }
export const isGuest = (s: unknown): s is Guest => !!s && (s as Guest).guest === true

export function useRequireSession(): Session | Guest | undefined {
  const session = useSession()
  return session === undefined ? undefined : session ?? GUEST
}

/** Re-runs `load` every few seconds — guests don't get Supabase Realtime pushes. */
export function usePolling(active: boolean, load: () => void, ms = 5000) {
  useEffect(() => {
    if (!active) return
    const t = setInterval(load, ms)
    return () => clearInterval(t)
  }, [active, load, ms])
}

/** If the Worker refuses guests (guest mode off), send the visitor to sign in. */
export function useSignInOn401(error: string | null) {
  const router = useRouter()
  useEffect(() => {
    if (error && /sign in first/i.test(error)) {
      const next = window.location.pathname.replace(process.env.NEXT_PUBLIC_BASE_PATH || '', '') + window.location.search
      router.replace(`/login?next=${encodeURIComponent(next)}`)
    }
  }, [error, router])
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
