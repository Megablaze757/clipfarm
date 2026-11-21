'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'

/**
 * Choose a new password. The link from the reset email arrives as
 * ?token_hash=…&type=recovery (Clipper's email) — spent with verifyOtp, works in
 * any browser — or, from Supabase's fallback email, as ?code= or #access_token.
 */
export default function ResetPasswordPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    void (async () => {
      const url = new URL(window.location.href)
      const tokenHash = url.searchParams.get('token_hash')
      const code = url.searchParams.get('code')
      try {
        if (tokenHash) {
          const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
          window.history.replaceState({}, '', url.pathname)
          if (error) throw error
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          window.history.replaceState({}, '', url.pathname)
          if (error) throw error
        }
        const { data } = await supabase.auth.getSession()
        if (!data.session) throw new Error('missing')
        setReady(true)
      } catch (e) {
        setLinkError(/expired|invalid|missing/i.test((e as Error).message)
          ? 'This reset link has expired or was already used. Ask for a new one below.'
          : (e as Error).message)
      }
    })()
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError('Use at least 8 characters.'); return }
    if (password !== confirm) { setError("Those passwords don't match."); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { setError(error.message); return }
    setDone(true)
    api.post('/v1/auth/password-changed', {}).catch(() => {}) // Clipper's security email
    setTimeout(() => router.replace('/projects'), 1500)
  }

  return (
    <main className="min-h-[80vh] flex items-center justify-center px-4 py-10">
      <div className="glass-panel rounded-2xl p-8 max-w-md w-full shadow-2xl">
        <h1 className="text-2xl font-bold mb-1 text-center text-white">Choose a new password</h1>
        {linkError ? (
          <div className="text-center space-y-4 mt-4">
            <p className="text-sm text-rose-300">{linkError}</p>
            <Link href="/login" className="inline-block text-sm text-indigo-300 underline">Back to sign in</Link>
          </div>
        ) : !ready ? (
          <p className="text-sm text-slate-400 text-center py-6 animate-pulse">Checking your link…</p>
        ) : done ? (
          <p className="text-sm text-emerald-300 text-center py-6">Password changed — taking you to your projects…</p>
        ) : (
          <form onSubmit={submit} className="space-y-4 mt-6">
            <div>
              <label htmlFor="pw" className="block text-xs font-medium text-slate-300 mb-1">New password</label>
              <input id="pw" type={show ? 'text' : 'password'} required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label htmlFor="pw2" className="block text-xs font-medium text-slate-300 mb-1">Type it again</label>
              <input id="pw2" type={show ? 'text' : 'password'} required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500" />
            </div>
            <label className="flex items-center gap-2 text-[11px] text-slate-400"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="accent-indigo-500" /> Show passwords</label>
            {error && <p className="text-xs text-rose-300" role="alert">{error}</p>}
            <button disabled={busy} className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-sm disabled:opacity-60">
              {busy ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
