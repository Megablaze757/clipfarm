'use client'
import React, { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { ErrorBox, Loading, isGuest, useRequireSession } from '@/components/use-session'

/** Team workspace (invite editors / viewers) + your referral link. */
interface Team { members: { id: string; email: string; role: string; created_at: string }[]; invites: { email: string; role: string; expires_at: string }[]; you: { id: string; role: string } | null }
interface Referral { code: string | null; link?: string; bonus_minutes?: number; reward_minutes?: number }

export default function TeamPage() {
  const session = useRequireSession()
  const [team, setTeam] = useState<Team | null>(null)
  const [ref, setRef] = useState<Referral | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('editor')
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const load = useCallback(() => {
    api.get<Team>('/v1/team').then(setTeam).catch((e) => setError((e as Error).message))
    api.get<Referral>('/v1/referral').then(setRef).catch(() => {})
  }, [])
  useEffect(() => { if (session) load() }, [session, load])

  if (!session) return <Loading />
  if (isGuest(session)) return <div className="max-w-2xl mx-auto px-6 py-16"><ErrorBox message="Sign in to invite your team and get a referral link." /></div>
  const owner = team?.you?.role === 'owner'

  async function invite(e: React.FormEvent) {
    e.preventDefault(); setMsg(null); setError(null)
    try { await api.post('/v1/team/invites', { email, role }); setMsg(`Invite sent to ${email}.`); setEmail(''); load() }
    catch (err) { setError((err as Error).message) }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <h1 className="text-3xl font-extrabold text-white tracking-tight">Team</h1>
      {error && <ErrorBox message={error} />}
      <section className="glass-panel rounded-2xl p-5 border border-slate-800 space-y-3">
        <h2 className="text-sm font-bold text-white">People in this workspace</h2>
        {!team ? <Loading /> : (
          <ul className="text-xs divide-y divide-slate-800/80">
            {team.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2 gap-3">
                <span className="text-slate-200 truncate">{m.email}{m.id === team.you?.id && <span className="text-slate-500"> (you)</span>}</span>
                <span className="flex items-center gap-3">
                  <span className="text-slate-400">{m.role}</span>
                  {owner && m.id !== team.you?.id && (
                    <button onClick={async () => { if (confirm(`Remove ${m.email}? They get their own empty workspace.`)) { await api.del(`/v1/team/members/${m.id}`).catch((e) => setError((e as Error).message)); load() } }} className="text-rose-300 underline">Remove</button>
                  )}
                </span>
              </li>
            ))}
            {team.invites.map((i) => (
              <li key={i.email} className="flex items-center justify-between py-2 gap-3">
                <span className="text-slate-400 truncate">{i.email} — invited</span>
                <span className="flex items-center gap-3"><span className="text-slate-500">{i.role}</span>
                  <button onClick={async () => { await api.del(`/v1/team/invites/${encodeURIComponent(i.email)}`); load() }} className="underline text-slate-400">Cancel</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {owner && (
          <form onSubmit={invite} className="flex flex-wrap gap-2 pt-2">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" className="flex-1 min-w-[200px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200" />
            <select value={role} onChange={(e) => setRole(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-xs text-slate-200">
              <option value="editor">Editor (can edit + export)</option>
              <option value="viewer">Viewer (can watch)</option>
            </select>
            <button className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-xs">Send invite</button>
          </form>
        )}
        {msg && <p className="text-xs text-emerald-300">{msg}</p>}
        {!owner && team && <p className="text-[11px] text-slate-500">Only the workspace owner can invite or remove people.</p>}
      </section>

      {ref?.code && (
        <section className="glass-panel rounded-2xl p-5 border border-indigo-500/30 space-y-2">
          <h2 className="text-sm font-bold text-white">Give {Math.round((ref.reward_minutes ?? 120) / 60)} hours, get {Math.round((ref.reward_minutes ?? 120) / 60)} hours</h2>
          <p className="text-xs text-slate-400">When someone signs up with your link and their first project finishes, you both get {ref.reward_minutes} bonus minutes.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 break-all">{ref.link}</code>
            <button onClick={() => { navigator.clipboard?.writeText(ref.link ?? ''); setCopied(true); setTimeout(() => setCopied(false), 1500) }} className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-200">{copied ? 'Copied' : 'Copy'}</button>
            <span className="text-xs text-slate-400">Code: <strong className="text-white">{ref.code}</strong></span>
          </div>
          {!!ref.bonus_minutes && <p className="text-xs text-emerald-300">You've earned {ref.bonus_minutes} bonus minutes so far.</p>}
        </section>
      )}
    </div>
  )
}
