'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession, Loading } from '@/components/use-session'
import { useMe } from '@/components/use-me'
import { api } from '@/lib/api'

/** Your account: email, plan, change password, sign out. */
export default function AccountPage() {
  const session = useSession()
  const me = useMe()
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => { if (session === null) router.replace('/login?next=/settings/account') }, [session, router])
  if (!session) return <Loading />

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setSaved(false)
    if (password.length < 8) { setError('Use at least 8 characters.'); return }
    if (password !== confirm) { setError("Those passwords don't match."); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { setError(/reauth|recent/i.test(error.message) ? 'For security, sign out and back in, then change it straight away.' : error.message); return }
    setPassword(''); setConfirm(''); setSaved(true)
    api.post('/v1/auth/password-changed', {}).catch(() => {}) // Clipper's security email
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <h1 className="text-3xl font-extrabold text-white tracking-tight">Account</h1>

      <section className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-2 text-sm">
        <div className="flex justify-between gap-4"><span className="text-slate-400">Email</span><span className="text-slate-100 truncate">{session.user.email}</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-400">Posting</span><Link href="/settings/connections" className="text-indigo-300 underline text-xs">YouTube · TikTok · Instagram connections</Link></div>
        <div className="flex justify-between gap-4"><span className="text-slate-400">Plan</span><span className="text-slate-100">{me?.plan?.label ?? '…'} <Link href="/settings/billing" className="ml-2 text-xs text-indigo-300 underline">Billing</Link></span></div>
        {me?.is_admin && <div className="flex justify-between gap-4"><span className="text-slate-400">Role</span><span className="text-amber-200">Admin · <Link href="/admin" className="underline">Admin panel</Link></span></div>}
      </section>

      <section className="glass-panel rounded-2xl p-6 border border-slate-800">
        <h2 className="text-lg font-bold text-white mb-4">Change password</h2>
        <form onSubmit={changePassword} className="space-y-3">
          <input type={show ? 'text' : 'password'} placeholder="New password (8+ characters)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500" />
          <input type={show ? 'text' : 'password'} placeholder="Type it again" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500" />
          <label className="flex items-center gap-2 text-[11px] text-slate-400"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="accent-indigo-500" /> Show passwords</label>
          {error && <p className="text-xs text-rose-300" role="alert">{error}</p>}
          {saved && <p className="text-xs text-emerald-300" role="status">Password changed.</p>}
          <button disabled={busy} className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm disabled:opacity-60">{busy ? 'Saving…' : 'Change password'}</button>
        </form>
      </section>

      <button onClick={async () => { await supabase.auth.signOut(); router.push('/') }} className="px-4 py-2 rounded-xl text-xs font-semibold border border-slate-700 text-slate-300 hover:bg-slate-800">Sign out</button>
    </div>
  )
}
