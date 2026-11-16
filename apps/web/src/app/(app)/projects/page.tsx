'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { StageRail } from '@/components/stage-rail'
import { ErrorBox, Loading, isGuest, usePolling, useRequireSession, useSignInOn401 } from '@/components/use-session'
import { api, ApiError, type Project } from '@/lib/api'
import { uploadFile } from '@/lib/upload'
import { supabase } from '@/lib/supabase'
import { formatDuration, timeAgo } from '@/lib/tokens'

const DURATIONS = [
  { label: 'Auto', value: 'auto' },
  { label: '~15s', value: '15' },
  { label: '~30s', value: '30' },
  { label: '~60s', value: '60' },
  { label: '~90s', value: '90' },
]

export default function ProjectsPage() {
  const session = useRequireSession()
  const router = useRouter()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'ready' | 'processing'>('all')
  const [url, setUrl] = useState('')
  const [duration, setDuration] = useState('auto')
  const [busy, setBusy] = useState<string | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    try {
      const q = filter === 'all' ? '' : `?status=${filter}`
      const { projects } = await api.get<{ projects: Project[] }>(`/v1/projects${q}`)
      setProjects(projects); setError(null)
    } catch (e) { setError((e as Error).message) }
  }, [filter])

  useEffect(() => { if (session) load() }, [session, load])
  usePolling(isGuest(session), load)
  useSignInOn401(error)

  // Realtime: project status changes stream in without polling (§13.1).
  useEffect(() => {
    if (!session || isGuest(session)) return
    const ch = supabase.channel('projects-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clip_projects' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [session, load])

  async function create(source: { kind: 'upload'; r2_key: string } | { kind: 'url'; url: string }, title?: string) {
    const options = { clip_durations: duration === 'auto' ? [] : [Number(duration)] }
    const p = await api.post<Project>('/v1/projects', { source, title, options }, { 'Idempotency-Key': crypto.randomUUID() })
    router.push(`/projects/view?id=${p.id}`)
  }

  async function onUrl(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setBusy('url'); setFormError(null)
    try { await create({ kind: 'url', url: url.trim() }) }
    catch (err) { setFormError(err instanceof ApiError ? err.message : String(err)) }
    finally { setBusy(null) }
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setBusy('upload'); setFormError(null); setUploadPct(0)
    abortRef.current = new AbortController()
    try {
      const key = await uploadFile(file, setUploadPct, abortRef.current.signal)
      await create({ kind: 'upload', r2_key: key }, file.name.replace(/\.[^.]+$/, ''))
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setFormError(err instanceof ApiError ? err.message : `${(err as Error).message} — pick the same file again to resume.`)
    } finally { setBusy(null); setUploadPct(null); if (fileRef.current) fileRef.current.value = '' }
  }

  if (!session) return <Loading />

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-10">
      <div className="border-b border-slate-800/80 pb-6">
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Projects</h1>
        <p className="text-slate-400 text-sm mt-1">Drop in a long video or paste a link. You get a ranked shortlist of clips, each with the reason it scored well.</p>
        {isGuest(session) && (
          <p className="mt-3 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 inline-block">
            Guest mode: no account needed. Everyone using the site without signing in shares this workspace.{' '}
            <Link href="/login" className="underline font-semibold">Sign in</Link> for your own.
          </p>
        )}
      </div>

      <section
        className="glass-panel rounded-2xl p-6 border border-indigo-500/20 shadow-xl space-y-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (!busy) onFile(e.dataTransfer.files?.[0]) }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-white">New project</h2>
          <div className="flex items-center gap-1 text-xs bg-slate-900 border border-slate-800 p-1 rounded-lg" role="radiogroup" aria-label="Clip length">
            {DURATIONS.map((d) => (
              <button key={d.value} role="radio" aria-checked={duration === d.value} onClick={() => setDuration(d.value)}
                className={`px-2.5 py-1 rounded-md ${duration === d.value ? 'bg-slate-700 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'}`}>{d.label}</button>
            ))}
          </div>
        </div>
        <form onSubmit={onUrl} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input value={url} onChange={(e) => setUrl(e.target.value)} type="url" placeholder="Paste a YouTube, Twitch, Vimeo or direct video link…"
            className="md:col-span-3 w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 outline-none font-mono" />
          <button disabled={!!busy || !url.trim()} className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-sm rounded-xl disabled:opacity-50">
            {busy === 'url' ? 'Starting…' : 'Import link'}
          </button>
        </form>
        <div className="rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-400">
          {uploadPct != null ? (
            <div className="space-y-2">
              <div className="text-slate-200 font-semibold">Uploading… {Math.round(uploadPct * 100)}%</div>
              <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden"><div className="bg-indigo-500 h-full transition-all" style={{ width: `${uploadPct * 100}%` }} /></div>
              <button onClick={() => abortRef.current?.abort()} className="text-xs underline">Pause (resume by picking the file again)</button>
            </div>
          ) : (
            <>Drag a file here or{' '}
              <button onClick={() => fileRef.current?.click()} disabled={!!busy} className="text-indigo-300 font-semibold hover:underline">choose a file</button>
              <span className="block text-[11px] mt-1 text-slate-500">mp4, mov, mkv, webm, mp3, wav, m4a, flac · up to 15 GB · up to 6 hours</span>
            </>
          )}
          <input ref={fileRef} type="file" className="hidden" accept=".mp4,.mov,.mkv,.webm,.mp3,.wav,.m4a,.flac,video/*,audio/*" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        {formError && <ErrorBox message={formError} />}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-bold text-white">Your projects</h2>
          <div className="flex items-center gap-1 text-xs font-medium text-slate-400 bg-slate-900 border border-slate-800 p-1 rounded-lg">
            {(['all', 'ready', 'processing'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1 rounded-md capitalize ${filter === f ? 'bg-slate-800 text-white font-semibold' : 'hover:text-slate-200'}`}>{f}</button>
            ))}
          </div>
        </div>
        {error && <ErrorBox message={error} onRetry={load} />}
        {!projects && !error && <Loading label="Loading projects…" />}
        {projects?.length === 0 && <p className="text-sm text-slate-400 py-10 text-center">No projects yet — start one above.</p>}
        <div className="grid grid-cols-1 gap-4">
          {projects?.map((p) => (
            <Link key={p.id} href={`/projects/view?id=${p.id}`} className="glass-panel glass-panel-hover rounded-2xl p-5 border border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-5">
              <div className="flex items-start gap-4 min-w-0">
                <div className="w-28 h-16 bg-slate-900 border border-slate-800 rounded-xl shrink-0 relative overflow-hidden">
                  {p.poster_url && <img src={p.poster_url} alt="" className="w-full h-full object-cover" />}
                  {p.duration_ms != null && <span className="absolute bottom-1 right-1 bg-slate-950/90 text-slate-300 px-1.5 py-0.5 rounded text-[10px] font-semibold">{formatDuration(p.duration_ms)}</span>}
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] text-slate-500 mb-1">{p.source_kind === 'url' ? 'Link' : 'Upload'} · {timeAgo(p.updated_at)}</div>
                  <h3 className="text-base font-bold text-white truncate">{p.title}</h3>
                  <div className="mt-2"><StageRail status={p.status} progress={p.progress} /></div>
                  {p.status === 'failed' && p.error_detail && <p className="text-xs text-rose-300 mt-2">{p.error_detail}</p>}
                </div>
              </div>
              {p.status === 'ready' && (
                <div className="text-right shrink-0">
                  <div className="text-sm font-extrabold text-indigo-300">{p.candidate_count} clips</div>
                  {p.top_score != null && <div className="text-[11px] text-slate-400">Top score <span className="text-emerald-400 font-bold">{Number(p.top_score).toFixed(0)}</span></div>}
                </div>
              )}
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
