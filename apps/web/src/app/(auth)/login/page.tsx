'use client'
import React, { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/components/use-session'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') || '/projects'
  const session = useSession()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => { if (session) router.replace(next) }, [session, next, router])

  const redirectTo = () => `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ''}/login?next=${encodeURIComponent(next)}`

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setNotice(null)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo() } })
        if (error) throw error
        if (!data.session) setNotice('Check your inbox to confirm your email, then sign in.')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function oauth(provider: 'google' | 'github') {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo() } })
    if (error) setError(error.message)
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="glass-panel rounded-2xl p-8 max-w-md w-full shadow-2xl">
        <h2 className="text-2xl font-bold mb-1 text-center text-white">{mode === 'signin' ? 'Sign in to Clipper' : 'Create your Clipper account'}</h2>
        <p className="text-slate-400 text-xs text-center mb-6">Free plan: 60 source minutes a month, no card.</p>
        <div className="grid grid-cols-2 gap-3 mb-5">
          <button onClick={() => oauth('google')} className="py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-sm font-semibold text-slate-200">Google</button>
          <button onClick={() => oauth('github')} className="py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-sm font-semibold text-slate-200">GitHub</button>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500 mb-5"><span className="flex-1 h-px bg-slate-800" />or with email<span className="flex-1 h-px bg-slate-800" /></div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-slate-300 mb-1">Email</label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-medium text-slate-300 mb-1">Password</label>
            <input id="password" type="password" required minLength={8} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500" />
          </div>
          {error && <p className="text-xs text-rose-300" role="alert">{error}</p>}
          {notice && <p className="text-xs text-emerald-300" role="status">{notice}</p>}
          <button disabled={busy} className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-sm disabled:opacity-60">
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p className="text-xs text-slate-400 text-center mt-5">
          {mode === 'signin' ? 'New here?' : 'Already have an account?'}{' '}
          <button className="text-indigo-300 font-semibold hover:underline" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null) }}>
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>
}
