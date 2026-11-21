'use client'
import React, { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { EmailOtpType } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/components/use-session'
import { API_URL } from '@/lib/api'

/**
 * Sign in / create account / forgot password — one page, three modes, the
 * same shape as FootballFitnessGuru's login.
 *
 * Emails come from Clipper (the Worker's /v1/auth/*), and their links come back
 * here as ?token_hash=…&type=… which this page spends with verifyOtp — that
 * works in any browser or mail app, unlike Supabase's redirect links (which
 * need the browser that asked). Every email is Clipper's own — never the
 * shared account system's default (PocketAthlete-branded) templates.
 */
type Mode = 'sign_in' | 'sign_up' | 'forgot'

async function viaWorker(path: string, payload: Record<string, string>): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const r = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }
  } catch {
    return { ok: false, status: 0, data: {} }
  }
}
const workerError = (d: any) => d?.error?.message ?? (typeof d?.error === 'string' ? d.error : null)

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') || '/projects'
  const session = useSession()
  const [mode, setMode] = useState<Mode>('sign_in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [awaitingConfirm, setAwaitingConfirm] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => { const m = params.get('mode'); if (m === 'sign_up' || m === 'forgot') setMode(m) }, [params])
  useEffect(() => { if (session) router.replace(next) }, [session, next, router])
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  // Confirmation / sign-in links from Clipper's emails.
  useEffect(() => {
    const url = new URL(window.location.href)
    const tokenHash = url.searchParams.get('token_hash')
    if (!tokenHash) return
    const urlErr = url.searchParams.get('error_description')
    if (urlErr) { setError(urlErr); return }
    const type = (url.searchParams.get('type') ?? 'email') as EmailOtpType
    setVerifying(true)
    void (async () => {
      const { error: vErr } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      url.searchParams.delete('token_hash'); url.searchParams.delete('type')
      window.history.replaceState({}, '', url.pathname + (url.search || ''))
      if (vErr) {
        setError(/expired|invalid/i.test(vErr.message)
          ? 'That link has expired or has already been used. Sign in below, or request a new one.'
          : vErr.message)
      } else {
        setInfo('Email confirmed — signing you in…')
      }
      setVerifying(false)
    })()
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setInfo(null)
    try {
      if (mode === 'forgot') {
        const r = await viaWorker('/v1/auth/recover', { email })
        if (!r.ok) throw new Error(workerError(r.data) ?? "We couldn't send the email just now — try again in a minute.")
        setInfo('If that email has an account, a reset link is on its way. Check your spam folder too.')
      } else if (mode === 'sign_in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          if (/confirm/i.test(error.message)) setAwaitingConfirm(true)
          throw new Error(/invalid login/i.test(error.message) ? 'Wrong email or password. Try again, or use “Forgot password?”.' : error.message)
        }
      } else {
        if (password.length < 8) throw new Error('Passwords need at least 8 characters.')
        const r = await viaWorker('/v1/auth/signup', { email, password })
        if (r.ok && r.data?.exists) { setInfo(r.data.message); setMode('sign_in'); return }
        if (r.ok) { setInfo('Check your email to confirm your account — the link signs you straight in.'); setAwaitingConfirm(true); setCooldown(60); return }
        throw new Error(workerError(r.data) ?? "We couldn't create your account just now — try again in a minute.")
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function resendConfirmation() {
    if (cooldown > 0 || !email) return
    setError(null); setInfo(null)
    const r = await viaWorker('/v1/auth/resend', { email })
    if (!r.ok) { setError(workerError(r.data) ?? "We couldn't send it just now — try again in a minute."); return }
    setInfo(`Sent again to ${email}. It can take a minute — check your spam folder too.`)
    setCooldown(60)
  }

  const title = mode === 'sign_in' ? 'Welcome back' : mode === 'sign_up' ? 'Create your Clipper account' : 'Reset your password'
  const sub = mode === 'sign_in' ? 'Sign in to your clips.' : mode === 'sign_up' ? 'Free plan: 60 source minutes a month, no card.' : "We'll email you a link to choose a new one."

  return (
    <main className="min-h-[80vh] flex items-center justify-center px-4 py-10">
      <div className="glass-panel rounded-2xl p-8 max-w-md w-full shadow-2xl">
        <h1 className="text-2xl font-bold mb-1 text-center text-white">{title}</h1>
        <p className="text-slate-400 text-xs text-center mb-6">{sub}</p>

        {verifying ? (
          <p className="text-sm text-slate-300 text-center py-6 animate-pulse">Confirming your email…</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-slate-300 mb-1">Email</label>
              <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500" />
            </div>
            {mode !== 'forgot' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="password" className="block text-xs font-medium text-slate-300">Password</label>
                  {mode === 'sign_in' && (
                    <button type="button" onClick={() => { setMode('forgot'); setError(null); setInfo(null) }} className="text-[11px] text-indigo-300 hover:underline">Forgot password?</button>
                  )}
                </div>
                <div className="relative">
                  <input id="password" type={showPassword ? 'text' : 'password'} required minLength={mode === 'sign_up' ? 8 : undefined}
                    autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 pr-16 text-sm text-slate-100 focus:outline-none focus:border-indigo-500" />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 hover:text-slate-200 px-2 py-1">
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                {mode === 'sign_up' && <p className="mt-1 text-[11px] text-slate-500">At least 8 characters.</p>}
              </div>
            )}
            {error && <p className="text-xs text-rose-300" role="alert">{error}</p>}
            {info && <p className="text-xs text-emerald-300" role="status">{info}</p>}
            {awaitingConfirm && (
              <button type="button" onClick={resendConfirmation} disabled={cooldown > 0 || !email} className="text-xs text-indigo-300 hover:underline disabled:text-slate-500 disabled:no-underline">
                {cooldown > 0 ? `Resend the email in ${cooldown}s` : "Didn't get the email? Send it again"}
              </button>
            )}
            <button disabled={busy} className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-sm disabled:opacity-60">
              {busy ? 'Working…' : mode === 'sign_in' ? 'Sign in' : mode === 'sign_up' ? 'Create account' : 'Send reset link'}
            </button>
          </form>
        )}

        <p className="text-xs text-slate-400 text-center mt-5">
          {mode === 'sign_in' ? 'New here?' : mode === 'sign_up' ? 'Already have an account?' : 'Remembered it?'}{' '}
          <button className="text-indigo-300 font-semibold hover:underline" onClick={() => { setMode(mode === 'sign_in' ? 'sign_up' : 'sign_in'); setError(null); setInfo(null); setAwaitingConfirm(false) }}>
            {mode === 'sign_in' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
        <p className="text-[11px] text-slate-500 text-center mt-3">
          <Link href="/projects" className="underline">Just looking? Try it as a guest</Link>
        </p>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>
}
