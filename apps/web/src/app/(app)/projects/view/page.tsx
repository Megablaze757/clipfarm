'use client'
import React, { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { StageRail } from '@/components/stage-rail'
import { ErrorBox, Loading, isGuest, usePolling, useRequireSession, useSignInOn401 } from '@/components/use-session'
import { api, type CandidateRow, type Project } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { CATEGORY_LABELS, formatDuration, SUBSCORE_LABELS } from '@/lib/tokens'

function ProjectView() {
  const session = useRequireSession()
  const id = useSearchParams().get('id') ?? ''
  const router = useRouter()
  const [project, setProject] = useState<Project | null>(null)
  const [cands, setCands] = useState<CandidateRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [opening, setOpening] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const p = await api.get<Project>(`/v1/projects/${id}`)
      setProject(p)
      if (p.status === 'ready') setCands((await api.get<{ candidates: CandidateRow[] }>(`/v1/projects/${id}/clips`)).candidates)
      setError(null)
    } catch (e) { setError((e as Error).message) }
  }, [id])

  useEffect(() => { if (session && id) load() }, [session, id, load])
  usePolling(isGuest(session) && !!project && !['ready', 'failed'].includes(project.status), load)
  useSignInOn401(error)

  // Live stage updates for this one project (subscribe narrowly — §13.1).
  useEffect(() => {
    if (!session || !id || isGuest(session)) return
    const ch = supabase.channel(`project-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'clip_projects', filter: `id=eq.${id}` }, (payload) => {
        const next = payload.new as Project
        setProject((p) => (p ? { ...p, ...next } : p))
        if (next.status === 'ready' || next.status === 'failed') load()
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [session, id, load])

  async function openClip(c: CandidateRow) {
    if (c.clip_id) return router.push(`/clips/view?id=${c.clip_id}`)
    setOpening(c.id)
    try {
      const { id: clipId } = await api.post<{ id: string }>('/v1/clips', { candidate_id: c.id })
      router.push(`/clips/view?id=${clipId}`)
    } catch (e) { setError((e as Error).message); setOpening(null) }
  }

  async function notGood(c: CandidateRow) {
    setHidden((h) => new Set(h).add(c.id))
    try {
      const clipId = c.clip_id ?? (await api.post<{ id: string }>('/v1/clips', { candidate_id: c.id })).id
      await api.post(`/v1/clips/${clipId}/feedback`, { signal: 'not_good' })
    } catch { /* feedback is best-effort */ }
  }

  if (!session || (!project && !error)) return <Loading />
  if (!project) return <div className="max-w-3xl mx-auto px-6 py-16"><ErrorBox message={error ?? 'Not found'} onRetry={load} /></div>

  const visible = (cands ?? []).filter((c) => !hidden.has(c.id))
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div className="min-w-0">
          <div className="text-xs text-slate-400 mb-2"><Link href="/projects" className="hover:text-indigo-300">Projects</Link> / <span className="text-slate-300">{project.title}</span></div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight truncate">{project.title}</h1>
          <div className="flex flex-wrap gap-x-3 text-xs text-slate-400 mt-2">
            {project.duration_ms != null && <span>{formatDuration(project.duration_ms)} source</span>}
            {project.status === 'ready' && <span>{visible.length} clips</span>}
          </div>
        </div>
        {project.status === 'failed' && (
          <button onClick={async () => { await api.post(`/v1/projects/${id}/retry`); load() }} className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold">Retry</button>
        )}
      </div>

      <div className="glass-panel rounded-2xl p-4 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <span className="font-bold text-white uppercase tracking-wider">
          {project.status === 'ready' ? 'Done' : project.status === 'failed' ? 'Something went wrong' : 'Working on it — this page updates by itself'}
        </span>
        <StageRail status={project.status} progress={project.progress} />
      </div>
      {project.status === 'failed' && <ErrorBox message={`${project.error_detail ?? 'Processing failed.'} (${project.error_code})`} />}
      {error && <ErrorBox message={error} onRetry={load} />}

      {project.status === 'ready' && (
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-white">Shortlist, best first</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {visible.map((c) => (
              <article key={c.id} className="glass-panel rounded-2xl p-4 border border-slate-800/80 flex flex-col gap-4">
                <div className="relative w-full aspect-[9/16] max-h-[420px] bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                  {c.proxy_url ? (
                    // Plays the clip straight from the source: the #t= fragment starts and
                    // stops it at the clip, object-cover does the centre 9:16 crop.
                    <video src={`${c.proxy_url}#t=${((c.t_in_ms - (c.features?.edit_key ? Number(c.features.edit_offset_ms ?? 0) : 0)) / 1000).toFixed(2)},${((c.t_out_ms - (c.features?.edit_key ? Number(c.features.edit_offset_ms ?? 0) : 0)) / 1000).toFixed(2)}`} poster={c.thumb_url ?? undefined} controls playsInline preload="none" className="w-full h-full object-cover" />
                  ) : <div className="w-full h-full grid place-items-center text-xs text-slate-500">No preview</div>}
                  <div className="absolute top-3 right-3 bg-slate-900/90 border border-emerald-500/30 text-emerald-300 px-2.5 py-1 rounded-full text-xs font-bold">{Number(c.score).toFixed(0)}</div>
                  <div className="absolute top-3 left-3 text-[10px] font-mono text-slate-200 bg-slate-900/80 px-2 py-0.5 rounded">{formatDuration(c.t_in_ms)} · {Math.round((c.t_out_ms - c.t_in_ms) / 1000)}s</div>
                </div>
                <div className="space-y-2 flex-1">
                  {c.features?.category && <span className="inline-block text-[10px] font-bold uppercase tracking-wide text-amber-200 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-md">{CATEGORY_LABELS[c.features.category] ?? c.features.category}</span>}
                  {c.features?.title && <h3 className="text-sm font-bold text-white leading-snug">{c.features.title}</h3>}
                  {c.features?.hook_line && <p className="text-xs text-slate-200 italic">“{c.features.hook_line}”</p>}
                  <p className="text-xs text-slate-300"><span className="text-slate-500">Why: </span>{c.rationale}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(c.features?.badges ?? []).map((b) => <span key={b} className="text-[10px] font-semibold text-indigo-200 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md">{b}</span>)}
                  </div>
                  {c.features?.unresolved && <p className="text-[11px] text-amber-300">May need context: “{c.features.unresolved}” isn’t introduced in the clip.</p>}
                  <details className="text-[11px] text-slate-400">
                    <summary className="cursor-pointer">Score breakdown</summary>
                    <ul className="mt-1 grid grid-cols-2 gap-x-3">
                      {Object.entries(c.subscores ?? {}).map(([k, v]) => <li key={k}>{SUBSCORE_LABELS[k] ?? k}: {Math.round(Number(v) * 100)}</li>)}
                    </ul>
                  </details>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openClip(c)} disabled={opening === c.id} className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold disabled:opacity-60">
                    {opening === c.id ? 'Opening…' : c.clip_status === 'exported' ? 'Exported · Edit' : 'Edit & export'}
                  </button>
                  <button onClick={() => notGood(c)} title="Hide this clip and teach the scorer" className="px-3 py-2.5 border border-slate-700 text-slate-300 hover:bg-slate-800 rounded-xl text-xs">Not good</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export default function ProjectPage() {
  return <Suspense fallback={<Loading />}><ProjectView /></Suspense>
}
