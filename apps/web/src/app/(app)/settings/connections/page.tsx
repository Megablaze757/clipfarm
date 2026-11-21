'use client'
import React, { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import { ErrorBox, Loading, isGuest, useRequireSession } from '@/components/use-session'

/** Connect YouTube / TikTok / Instagram, so clips can be posted (or scheduled) from the editor. */
interface Conn { platform: string; label: string; available: boolean; connected: boolean; account: string | null; connected_at: string | null }

function Connections() {
  const session = useRequireSession()
  const params = useSearchParams()
  const [list, setList] = useState<Conn[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(() => api.get<{ connections: Conn[] }>('/v1/connections').then((r) => setList(r.connections)).catch((e) => setError((e as Error).message)), [])
  useEffect(() => { if (session) load() }, [session, load])

  async function connect(p: string) {
    setBusy(p); setError(null)
    try { const { url } = await api.get<{ url: string }>(`/v1/connect/${p}`); window.location.href = url }
    catch (e) { setError((e as Error).message); setBusy(null) }
  }
  async function disconnect(p: string) {
    if (!confirm('Disconnect this account? Scheduled posts to it will fail.')) return
    setBusy(p)
    try { await api.del(`/v1/connections/${p}`); load() } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }

  if (!session || (!list && !error)) return <Loading />
  const connected = params.get('connected'), failed = params.get('error')
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Connections</h1>
        <p className="text-sm text-slate-400 mt-1">Connect your accounts to post clips straight from the editor — now or scheduled.</p>
      </div>
      {isGuest(session) && <ErrorBox message="Sign in to connect your own accounts." />}
      {connected && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">Connected {connected}.</div>}
      {failed && <ErrorBox message={`Couldn't connect: ${failed}`} />}
      {error && <ErrorBox message={error} />}
      <div className="space-y-3">
        {list?.map((c) => (
          <div key={c.platform} className="glass-panel rounded-2xl p-4 border border-slate-800 flex items-center justify-between gap-4">
            <div>
              <div className="font-bold text-white text-sm">{c.label}</div>
              <div className="text-xs text-slate-400 mt-0.5">
                {c.connected ? `Connected as ${c.account}` : c.available ? 'Not connected' : 'Not set up on this server yet'}
              </div>
            </div>
            {c.connected ? (
              <button onClick={() => disconnect(c.platform)} disabled={busy === c.platform} className="px-3 py-2 rounded-lg text-xs border border-slate-700 text-slate-300 hover:bg-slate-800">Disconnect</button>
            ) : (
              <button onClick={() => connect(c.platform)} disabled={!c.available || busy === c.platform || isGuest(session)}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-indigo-600 to-purple-600 text-white disabled:opacity-40">
                {busy === c.platform ? 'Opening…' : 'Connect'}
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">
        TikTok clips arrive in your TikTok inbox to finish posting in the app. Instagram needs a professional (business or creator) account linked to a Facebook Page.
        Clipper only posts what you choose to post.
      </p>
    </div>
  )
}

export default function ConnectionsPage() {
  return <Suspense fallback={<Loading />}><Connections /></Suspense>
}
