'use client'
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ErrorBox, Loading, useRequireSession } from '@/components/use-session'
import { api, type Plan } from '@/lib/api'
import { autoReframe, cxAt, type Keyframe } from '@/lib/reframe'
import { formatPrecise } from '@/lib/tokens'

interface Word { i: number; w: string; t0: number; t1: number; speaker?: string }
interface Render { id: string; preset: string; status: string; download_url: string | null; error_code?: string | null }
interface ClipResponse {
  clip: { id: string; title: string | null; t_in_ms: number; t_out_ms: number; status: string; edits: any }
  candidate: { id: string; score: number; rationale: string | null; features: any } | null
  project: { id: string; title: string; review_url: string | null; duration_ms: number | null } | null
  words: Word[]
  renders: Render[]
  plan: Plan
}

interface EditState {
  t_in: number
  t_out: number
  title: string
  captionsOn: boolean
  style: string
  fixes: Record<number, string>
  mode: 'auto' | 'center' | 'fit' | 'manual'
  aspect: string
  keyframes: Keyframe[]
  overlay: string
}

const ASPECTS: Record<string, { ratio: number; presets: { id: string; label: string }[] }> = {
  '9:16': { ratio: 9 / 16, presets: [{ id: 'tiktok', label: 'TikTok' }, { id: 'reels', label: 'Reels' }, { id: 'shorts', label: 'YouTube Shorts' }] },
  '4:5': { ratio: 4 / 5, presets: [{ id: 'linkedin', label: 'LinkedIn / feed' }] },
  '1:1': { ratio: 1, presets: [{ id: 'square', label: 'Square' }] },
  '16:9': { ratio: 16 / 9, presets: [{ id: 'landscape', label: 'Landscape' }] },
}
const STYLES = [
  { id: 'karaoke_yellow', label: 'Karaoke — yellow highlight' },
  { id: 'neon_box', label: 'Boxed — cyan highlight' },
  { id: 'classic', label: 'Classic subtitles' },
]

function toState(r: ClipResponse): EditState {
  const e = r.clip.edits ?? {}
  const fixes: Record<number, string> = {}
  for (const f of e.captions?.edits ?? []) fixes[f.word_index] = f.text
  return {
    t_in: r.clip.t_in_ms, t_out: r.clip.t_out_ms, title: r.clip.title ?? '',
    captionsOn: e.captions?.enabled !== false, style: e.captions?.style ?? 'karaoke_yellow', fixes,
    mode: e.layout?.mode ?? 'auto', aspect: e.layout?.aspect ?? '9:16', keyframes: e.layout?.keyframes ?? [],
    overlay: e.title_overlay ?? '',
  }
}

function toPatch(s: EditState) {
  return {
    t_in_ms: Math.round(s.t_in), t_out_ms: Math.round(s.t_out), title: s.title,
    captions: { enabled: s.captionsOn, style: s.style, edits: Object.entries(s.fixes).map(([i, text]) => ({ word_index: Number(i), text })) },
    layout: { mode: s.mode, aspect: s.aspect, keyframes: s.mode === 'fit' || s.mode === 'center' ? [] : s.keyframes },
    title_overlay: s.overlay,
  }
}

function Studio() {
  const session = useRequireSession()
  const id = useSearchParams().get('id') ?? ''
  const [data, setData] = useState<ClipResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<EditState | null>(null)
  const history = useRef<{ past: EditState[]; future: EditState[] }>({ past: [], future: [] })
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [now, setNow] = useState(0)
  const [editing, setEditing] = useState<number | null>(null)
  const [reframing, setReframing] = useState<number | null>(null)
  const [reframeNote, setReframeNote] = useState<string | null>(null)
  const [renders, setRenders] = useState<Render[]>([])
  const [preset, setPreset] = useState('tiktok')
  const [exporting, setExporting] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [srcAspect, setSrcAspect] = useState(16 / 9)

  const load = useCallback(async () => {
    try {
      const r = await api.get<ClipResponse>(`/v1/clips/${id}`)
      setData(r); setState(toState(r)); setRenders(r.renders)
      setPreset(ASPECTS[toState(r).aspect]?.presets[0].id ?? 'tiktok')
    } catch (e) { setError((e as Error).message) }
  }, [id])
  useEffect(() => { if (session && id) load() }, [session, id, load])

  // Every change goes through here: it is what undo/redo (≥50 steps, FR-10.2) records.
  // History lives outside the state updater so React's double-invoked updaters
  // (StrictMode) can't record a step twice.
  const stateRef = useRef<EditState | null>(null)
  stateRef.current = state
  const commit = (next: EditState) => { stateRef.current = next; setState(next) }
  const update = useCallback((fn: (s: EditState) => EditState) => {
    const s = stateRef.current
    if (!s) return
    history.current.past = [...history.current.past.slice(-99), s]
    history.current.future = []
    commit(fn(s))
  }, [])
  const undo = useCallback(() => {
    const s = stateRef.current, prev = history.current.past.pop()
    if (!s || !prev) return
    history.current.future.push(s)
    commit(prev)
  }, [])
  const redo = useCallback(() => {
    const s = stateRef.current, next = history.current.future.pop()
    if (!s || !next) return
    history.current.past.push(s)
    commit(next)
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
      if (e.key === ' ' && videoRef.current) { e.preventDefault(); videoRef.current.paused ? play() : videoRef.current.pause() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Autosave (non-destructive: only timestamps and edit JSON are stored, FR-10.1).
  const firstSave = useRef(true)
  useEffect(() => {
    if (!state || !data) return
    if (firstSave.current) { firstSave.current = false; return }
    setSaveState('saving')
    const t = setTimeout(async () => {
      try { await api.patch(`/v1/clips/${id}`, toPatch(state)); setSaveState('saved') }
      catch (e) { setSaveState('error'); setError((e as Error).message) }
    }, 700)
    return () => clearTimeout(t)
  }, [state, data, id])

  // Playback confined to the trim, with the crop preview following the keyframes.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const v = videoRef.current
      if (v && state) {
        const t = v.currentTime * 1000
        if (!v.paused && t >= state.t_out) { v.pause(); v.currentTime = state.t_in / 1000 }
        setNow(t)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [state])

  function play() {
    const v = videoRef.current
    if (!v || !state) return
    if (v.currentTime * 1000 < state.t_in || v.currentTime * 1000 >= state.t_out - 100) v.currentTime = state.t_in / 1000
    v.play().catch(() => {})
  }

  async function runReframe() {
    const v = videoRef.current
    if (!v || !state || !data) return
    setReframing(0); setReframeNote(null)
    try {
      const res = await autoReframe(v, state.t_in, state.t_out, data.words, ASPECTS[state.aspect].ratio, setReframing)
      update((s) => ({ ...s, mode: res.mode === 'manual' ? 'auto' : res.mode, keyframes: res.keyframes }))
      setReframeNote(res.note)
    } catch (e) {
      // MediaPipe unavailable (old browser / blocked CDN): fall back to centre.
      update((s) => ({ ...s, mode: 'center', keyframes: [] }))
      setReframeNote(`Face tracking isn't available in this browser (${(e as Error).message}). Using a centre crop.`)
    } finally {
      setReframing(null)
      v.currentTime = state.t_in / 1000
    }
  }

  async function exportClip() {
    setExporting(true); setError(null)
    try {
      await api.patch(`/v1/clips/${id}`, toPatch(state!))
      const job = await api.post<{ id: string }>(`/v1/clips/${id}/render`, { preset })
      setRenders((r) => [{ id: job.id, preset, status: 'queued', download_url: null }, ...r])
    } catch (e) { setError((e as Error).message) } finally { setExporting(false) }
  }

  // Poll running renders (finals take well under a minute; polling is fine here).
  useEffect(() => {
    const pending = renders.filter((r) => r.status === 'queued' || r.status === 'running')
    if (!pending.length) return
    const t = setInterval(async () => {
      const fresh = await Promise.all(pending.map((r) => api.get<Render>(`/v1/renders/${r.id}`).catch(() => r)))
      setRenders((all) => all.map((r) => fresh.find((f) => f.id === r.id) ?? r))
    }, 3000)
    return () => clearInterval(t)
  }, [renders])

  const words = data?.words ?? []
  const inClip = useMemo(() => (state ? words.filter((w) => w.t1 > state.t_in && w.t0 < state.t_out) : []), [words, state])
  const captionLine = useMemo(() => {
    if (!state?.captionsOn) return null
    const idx = inClip.findIndex((w) => now >= w.t0 - 80 && now < w.t1 + 120)
    if (idx < 0) return null
    const start = Math.floor(idx / 5) * 5
    return { words: inClip.slice(start, start + 5), active: inClip[idx].i }
  }, [inClip, now, state?.captionsOn])

  if (!session || (!data && !error)) return <Loading />
  if (!data || !state) return <div className="max-w-3xl mx-auto px-6 py-16"><ErrorBox message={error ?? 'Not found'} onRetry={load} /></div>

  const aspect = ASPECTS[state.aspect] ?? ASPECTS['9:16']
  const rel = Math.max(0, now - state.t_in)
  const cx = state.mode === 'center' ? 0.5 : cxAt(state.keyframes, rel)
  const frameH = 460
  const frameW = Math.round(frameH * aspect.ratio)
  const vidW = frameH * srcAspect
  const left = state.mode === 'fit' ? (frameW - vidW) / 2 : Math.min(0, Math.max(frameW - vidW, frameW / 2 - cx * vidW))
  const windowStart = Math.max(0, data.clip.t_in_ms - 60_000)
  const windowEnd = Math.min(data.project?.duration_ms ?? data.clip.t_out_ms + 60_000, data.clip.t_out_ms + 60_000)
  const dur = state.t_out - state.t_in
  const fixed = (w: Word) => state.fixes[w.i] ?? w.w

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div className="min-w-0">
          <div className="text-xs text-slate-400 mb-1">
            <Link href="/projects" className="hover:text-indigo-300">Projects</Link> / {data.project && <Link href={`/projects/view?id=${data.project.id}`} className="hover:text-indigo-300">{data.project.title}</Link>}
          </div>
          <input value={state.title} onChange={(e) => update((s) => ({ ...s, title: e.target.value }))} aria-label="Clip title"
            className="bg-transparent text-xl font-bold text-white w-full outline-none focus:bg-slate-900 rounded px-1 -mx-1" />
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className={saveState === 'error' ? 'text-rose-300' : 'text-slate-500'}>{saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : 'Saved'}</span>
          <button onClick={undo} className="px-2 py-1.5 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-800" title="Undo (Ctrl+Z)">Undo</button>
          <button onClick={redo} className="px-2 py-1.5 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-800" title="Redo (Ctrl+Shift+Z)">Redo</button>
        </div>
      </div>
      {error && <ErrorBox message={error} />}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-6 space-y-4">
          <div className="glass-panel rounded-3xl p-5 border border-slate-800 flex flex-col items-center gap-4">
            <div ref={frameRef} className="relative bg-black rounded-2xl overflow-hidden border-2 border-slate-800 shadow-2xl" style={{ width: frameW, height: frameH, maxWidth: '100%' }}>
              {state.mode === 'fit' && <div className="absolute inset-0 bg-slate-800/60 blur-xl" />}
              {data.project?.review_url ? (
                <video ref={videoRef} src={data.project.review_url} crossOrigin="anonymous" playsInline preload="auto"
                  onLoadedMetadata={(e) => { const v = e.currentTarget; setSrcAspect(v.videoWidth / Math.max(1, v.videoHeight)); v.currentTime = state.t_in / 1000 }}
                  onClick={() => (videoRef.current?.paused ? play() : videoRef.current?.pause())}
                  className="absolute top-0 max-w-none cursor-pointer"
                  style={state.mode === 'fit' ? { width: frameW, height: frameW / srcAspect, top: (frameH - frameW / srcAspect) / 2, left: 0 } : { height: frameH, width: vidW, left }} />
              ) : <div className="absolute inset-0 grid place-items-center text-xs text-slate-500 p-6 text-center">The review video is still being prepared.</div>}
              {state.overlay && rel < 2500 && <div className="absolute top-[12%] inset-x-4 text-center"><span className="bg-black/60 text-white font-bold text-sm px-2 py-1 rounded">{state.overlay}</span></div>}
              {captionLine && (
                <div className="absolute inset-x-3 bottom-[22%] text-center pointer-events-none">
                  <span className={`inline-block px-2 py-1 rounded font-extrabold text-[15px] leading-snug ${state.style === 'neon_box' ? 'bg-black/70' : ''}`} style={{ textShadow: state.style !== 'neon_box' ? '0 0 4px #000, 0 0 2px #000' : undefined }}>
                    {captionLine.words.map((w) => (
                      <span key={w.i} className={w.i === captionLine.active && state.style !== 'classic' ? (state.style === 'neon_box' ? 'text-cyan-300' : 'text-yellow-300') : 'text-white'}>
                        {state.style === 'karaoke_yellow' ? fixed(w).toUpperCase() : fixed(w)}{' '}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {data.plan.watermark && <div className="absolute top-3 right-3 text-[10px] text-white/70">Made with Clipper</div>}
              {reframing != null && <div className="absolute inset-0 bg-black/60 grid place-items-center text-xs text-white">Tracking faces… {Math.round(reframing * 100)}%</div>}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={play} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white">▶ Play clip</button>
              <span className="text-xs font-mono text-slate-400">{formatPrecise(rel)} / {formatPrecise(dur)}</span>
            </div>

            <div className="w-full space-y-3 bg-slate-950/80 border border-slate-800 rounded-xl p-3">
              <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                <span>In {formatPrecise(state.t_in)}</span>
                <span className={dur < 8000 || dur > 180000 ? 'text-rose-300 font-bold' : 'text-indigo-300 font-bold'}>{(dur / 1000).toFixed(1)}s</span>
                <span>Out {formatPrecise(state.t_out)}</span>
              </div>
              <label className="block text-[11px] text-slate-400">Start
                <input type="range" className="w-full accent-indigo-500" min={windowStart} max={windowEnd} step={100} value={state.t_in}
                  onChange={(e) => { const v = Number(e.target.value); if (state.t_out - v >= 8000) { update((s) => ({ ...s, t_in: v })); if (videoRef.current) videoRef.current.currentTime = v / 1000 } }} />
              </label>
              <label className="block text-[11px] text-slate-400">End
                <input type="range" className="w-full accent-indigo-500" min={windowStart} max={windowEnd} step={100} value={state.t_out}
                  onChange={(e) => { const v = Number(e.target.value); if (v - state.t_in >= 8000) { update((s) => ({ ...s, t_out: v })); if (videoRef.current) videoRef.current.currentTime = Math.max(state.t_in, v - 2000) / 1000 } }} />
              </label>
              <p className="text-[11px] text-slate-500">Tip: Alt-click a word to start there, Shift-click to end there. Space plays/pauses.</p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 space-y-6">
          <section className="glass-panel rounded-3xl p-5 border border-slate-800 space-y-3">
            <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Transcript & captions</h2>
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-sm leading-relaxed max-h-72 overflow-y-auto">
              {words.map((w) => {
                const inside = w.t1 > state.t_in && w.t0 < state.t_out
                const active = now >= w.t0 && now < w.t1
                if (editing === w.i) {
                  return <input key={w.i} autoFocus defaultValue={fixed(w)} size={Math.max(3, fixed(w).length)}
                    className="bg-indigo-950 text-white px-1 rounded outline-none border border-indigo-500 mx-0.5"
                    onBlur={(e) => { const t = e.target.value.trim(); setEditing(null); if (t !== fixed(w)) update((s) => ({ ...s, fixes: { ...s.fixes, [w.i]: t } })) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }} />
                }
                return (
                  <span key={w.i}
                    onClick={(e) => {
                      if (e.altKey) update((s) => ({ ...s, t_in: Math.max(0, w.t0 - 100) }))
                      else if (e.shiftKey) update((s) => ({ ...s, t_out: w.t1 + 150 }))
                      else setEditing(w.i)
                    }}
                    title={`${formatPrecise(w.t0)} — click to fix the caption`}
                    className={`cursor-pointer rounded px-0.5 ${inside ? 'text-slate-100' : 'text-slate-600'} ${active ? 'bg-amber-400/30' : 'hover:bg-indigo-500/20'} ${state.fixes[w.i] != null ? 'underline decoration-indigo-400' : ''}`}>
                    {fixed(w) || <s className="text-slate-600">{w.w}</s>}{' '}
                  </span>
                )
              })}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-slate-400">Caption style
                <select value={state.style} onChange={(e) => update((s) => ({ ...s, style: e.target.value }))} className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200">
                  {STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-400 flex items-end gap-2 pb-2">
                <input type="checkbox" checked={state.captionsOn} onChange={(e) => update((s) => ({ ...s, captionsOn: e.target.checked }))} className="accent-indigo-500" />
                Burn captions into the video
              </label>
            </div>
            <label className="block text-xs text-slate-400">Title card (first 2.5 s, optional)
              <input value={state.overlay} maxLength={80} onChange={(e) => update((s) => ({ ...s, overlay: e.target.value }))} className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200" />
            </label>
          </section>

          <section className="glass-panel rounded-3xl p-5 border border-slate-800 space-y-3">
            <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Layout</h2>
            <div className="flex flex-wrap gap-2">
              {Object.keys(ASPECTS).map((a) => (
                <button key={a} onClick={() => { update((s) => ({ ...s, aspect: a })); setPreset(ASPECTS[a].presets[0].id) }}
                  className={`px-3 py-1.5 rounded-lg text-xs border ${state.aspect === a ? 'border-indigo-500 bg-indigo-500/15 text-white' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}>{a}</button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={runReframe} disabled={reframing != null || !data.project?.review_url} className="px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50">
                {reframing != null ? 'Tracking…' : 'Auto-frame the speaker'}
              </button>
              {(['center', 'fit'] as const).map((m) => (
                <button key={m} onClick={() => update((s) => ({ ...s, mode: m, keyframes: [] }))}
                  className={`px-3 py-2 rounded-lg text-xs border ${state.mode === m ? 'border-indigo-500 text-white' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}>{m === 'center' ? 'Centre crop' : 'Fit (blurred bars)'}</button>
              ))}
            </div>
            {state.mode !== 'fit' && (
              <label className="block text-xs text-slate-400">Manual position (locks a static crop)
                <input type="range" min={0} max={1} step={0.01} value={cx} className="w-full accent-indigo-500"
                  onChange={(e) => update((s) => ({ ...s, mode: 'manual', keyframes: [{ t_ms: 0, cx: Number(e.target.value) }] }))} />
              </label>
            )}
            <p className="text-[11px] text-slate-500">{reframeNote ?? (state.keyframes.length > 1 ? `Following the speaker (${state.keyframes.length} keyframes).` : state.mode === 'fit' ? 'Whole frame, letterboxed.' : 'Static crop.')}</p>
          </section>

          <section className="glass-panel rounded-3xl p-5 border border-slate-800 space-y-3">
            <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Export</h2>
            <div className="flex flex-wrap items-center gap-3">
              <select value={preset} onChange={(e) => setPreset(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200" aria-label="Export preset">
                {aspect.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <button onClick={exportClip} disabled={exporting || dur < 8000 || dur > 180000}
                className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold disabled:opacity-50">
                {exporting ? 'Starting…' : 'Export MP4'}
              </button>
            </div>
            {data.plan.watermark && <p className="text-[11px] text-slate-500">Free plan exports carry a small watermark. <Link href="/settings/billing" className="text-indigo-300 underline">Upgrade</Link> to remove it.</p>}
            <ul className="space-y-2">
              {renders.map((r) => (
                <li key={r.id} className="flex items-center justify-between text-xs bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
                  <span className="text-slate-300">{r.preset}</span>
                  {r.status === 'completed' && r.download_url ? <a href={r.download_url} className="text-emerald-300 font-semibold underline">Download</a>
                    : r.status === 'failed' ? <span className="text-rose-300">Failed ({r.error_code})</span>
                    : <span className="text-slate-400 animate-pulse">Rendering…</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

export default function ClipPage() {
  return <Suspense fallback={<Loading />}><Studio /></Suspense>
}
