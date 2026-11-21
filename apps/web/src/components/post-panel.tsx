'use client'
import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'

/**
 * POST — send an exported clip to YouTube Shorts / TikTok / Instagram Reels,
 * now or at a set time (up to 6 days ahead). Only connected accounts show.
 */
interface Conn { platform: string; label: string; available: boolean; connected: boolean; account: string | null }
interface Post { id: string; platform: string; scheduled_for: string; status: string; result?: string; error?: string }

export function PostPanel({ clipId, renderId, headline, title }: { clipId: string; renderId: string | null; headline: string; title: string }) {
  const [conns, setConns] = useState<Conn[] | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [pick, setPick] = useState<Set<string>>(new Set())
  const [caption, setCaption] = useState('')
  const [postTitle, setPostTitle] = useState('')
  const [when, setWhen] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const loadPosts = useCallback(() => api.get<{ posts: Post[] }>(`/v1/clips/${clipId}/posts`).then((r) => setPosts(r.posts)).catch(() => {}), [clipId])
  useEffect(() => { api.get<{ connections: Conn[] }>('/v1/connections').then((r) => setConns(r.connections)).catch(() => setConns([])); loadPosts() }, [loadPosts])
  useEffect(() => { setPostTitle((t) => t || (headline ? headline.charAt(0) + headline.slice(1).toLowerCase() : title)) }, [headline, title])
  useEffect(() => {
    if (!posts.some((p) => p.status === 'posting' || (p.status === 'scheduled' && new Date(p.scheduled_for).getTime() < Date.now() + 120_000))) return
    const t = setInterval(loadPosts, 5000)
    return () => clearInterval(t)
  }, [posts, loadPosts])

  const connected = (conns ?? []).filter((c) => c.connected)
  async function send() {
    if (!renderId || !pick.size) return
    setBusy(true); setMsg(null)
    try {
      await api.post(`/v1/clips/${clipId}/posts`, { render_id: renderId, platforms: [...pick], title: postTitle, caption, schedule_at: when ? new Date(when).toISOString() : undefined })
      setMsg(when ? 'Scheduled.' : 'Posting now…'); setPick(new Set()); loadPosts()
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }

  if (!conns) return null
  return (
    <section className="glass-panel rounded-3xl p-5 border border-slate-800 space-y-3">
      <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Post</h2>
      {!connected.length ? (
        <p className="text-xs text-slate-400">Connect YouTube, TikTok or Instagram to post from here. <Link href="/settings/connections" className="text-indigo-300 underline">Connections</Link></p>
      ) : !renderId ? (
        <p className="text-xs text-slate-400">Export the clip first, then post it here.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {connected.map((c) => (
              <label key={c.platform} className={`px-3 py-1.5 rounded-lg border text-xs cursor-pointer ${pick.has(c.platform) ? 'border-indigo-400 bg-indigo-500/15 text-white' : 'border-slate-700 text-slate-300'}`}>
                <input type="checkbox" className="hidden" checked={pick.has(c.platform)} onChange={(e) => setPick((s) => { const n = new Set(s); if (e.target.checked) n.add(c.platform); else n.delete(c.platform); return n })} />
                {c.label} <span className="text-slate-500">({c.account})</span>
              </label>
            ))}
          </div>
          <input value={postTitle} maxLength={100} onChange={(e) => setPostTitle(e.target.value)} placeholder="Title" className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200" />
          <textarea value={caption} maxLength={2000} rows={3} onChange={(e) => setCaption(e.target.value)} placeholder="Caption and hashtags (e.g. #podcast #clips)" className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200" />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="text-slate-400">When
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="ml-2 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-200" />
            </label>
            <button onClick={send} disabled={busy || !pick.size} className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold disabled:opacity-50">
              {busy ? 'Sending…' : when ? 'Schedule' : 'Post now'}
            </button>
          </div>
          {msg && <p className="text-xs text-slate-300">{msg}</p>}
        </>
      )}
      {!!posts.length && (
        <ul className="space-y-1 text-[11px]">
          {posts.map((p) => (
            <li key={p.id} className="flex justify-between gap-3">
              <span className="text-slate-300">{p.platform} · {new Date(p.scheduled_for).toLocaleString()}</span>
              <span className={p.status === 'posted' ? 'text-emerald-300' : p.status === 'failed' ? 'text-rose-300' : 'text-amber-200'}>
                {p.status === 'posted' && p.result?.startsWith('http') ? <a href={p.result} target="_blank" rel="noreferrer" className="underline">posted</a> : p.status}
                {p.error ? `: ${p.error}` : p.status === 'posted' && p.result && !p.result.startsWith('http') ? ` — ${p.result}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
