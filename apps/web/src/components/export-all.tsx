'use client'
import React, { useState } from 'react'
import { zip } from 'fflate'
import { api, type CandidateRow } from '@/lib/api'

/**
 * EXPORT ALL — renders the top N clips (4 at a time, each its own export job)
 * and hands back ONE zip, files named after their headlines. Clips are
 * already compressed video, so the zip just stores them (fast, no re-encode).
 */
const PRESETS = [{ id: 'tiktok', label: 'TikTok / Reels / Shorts (9:16)' }, { id: 'square', label: 'Square (1:1)' }, { id: 'landscape', label: 'Landscape (16:9)' }]
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'clip'
type Row = { id: string; name: string; state: 'waiting' | 'exporting' | 'downloading' | 'done' | 'failed'; note?: string }

export function ExportAll({ candidates, projectTitle }: { candidates: CandidateRow[]; projectTitle: string }) {
  const [count, setCount] = useState(5)
  const [preset, setPreset] = useState('tiktok')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    const pick = candidates.slice(0, count >= 999 ? candidates.length : count)
    if (!pick.length) return
    setBusy(true); setError(null)
    const list: Row[] = pick.map((c, i) => ({ id: c.id, name: `${String(i + 1).padStart(2, '0')}-${slug(c.features?.context_title || c.features?.title || 'clip')}.mp4`, state: 'waiting' }))
    setRows(list)
    const update = (i: number, patch: Partial<Row>) => setRows((r) => (r ? r.map((x, k) => (k === i ? { ...x, ...patch } : x)) : r))
    const files: Record<string, Uint8Array> = {}
    let next = 0
    const worker = async () => {
      while (next < pick.length) {
        const i = next++
        const c = pick[i]
        try {
          update(i, { state: 'exporting' })
          const clipId = c.clip_id ?? (await api.post<{ id: string }>('/v1/clips', { candidate_id: c.id })).id
          const job = await api.post<{ id: string }>(`/v1/clips/${clipId}/render`, { preset }).catch(async (e) => {
            // Already rendering (e.g. a second click) — wait for that one instead.
            if (/already rendering/i.test((e as Error).message)) {
              const clip = await api.get<{ renders: { id: string }[] }>(`/v1/clips/${clipId}`)
              if (clip.renders[0]) return clip.renders[0]
            }
            throw e
          })
          let url: string | null = null
          for (let t = 0; t < 400; t++) {
            const r = await api.get<{ status: string; download_url: string | null; error_detail?: string }>(`/v1/renders/${job.id}`)
            if (r.status === 'completed' && r.download_url) { url = r.download_url; break }
            if (r.status === 'failed' || r.status === 'expired') throw new Error(r.error_detail || r.status)
            await new Promise((res) => setTimeout(res, 3000))
          }
          if (!url) throw new Error('timed out')
          update(i, { state: 'downloading' })
          const res = await fetch(url)
          if (!res.ok) throw new Error(`download ${res.status}`)
          files[list[i].name] = new Uint8Array(await res.arrayBuffer())
          update(i, { state: 'done' })
        } catch (e) {
          update(i, { state: 'failed', note: (e as Error).message.slice(0, 80) })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, pick.length) }, worker))
    if (!Object.keys(files).length) { setError('None of the clips could be exported — see the list above.'); setBusy(false); return }
    zip(Object.fromEntries(Object.entries(files).map(([n, d]) => [n, [d, { level: 0 }]])), (err, data) => {
      setBusy(false)
      if (err) { setError(err.message); return }
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/zip' }))
      a.download = `${slug(projectTitle)}-clips.zip`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
    })
  }

  const done = rows?.filter((r) => r.state === 'done').length ?? 0
  return (
    <div className="glass-panel rounded-2xl p-4 border border-slate-800 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-bold text-white">Export all</span>
        <select value={count} onChange={(e) => setCount(Number(e.target.value))} disabled={busy} className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200">
          {[3, 5, 10].filter((n) => n < candidates.length).map((n) => <option key={n} value={n}>Top {n}</option>)}
          <option value={999}>All {candidates.length}</option>
        </select>
        <select value={preset} onChange={(e) => setPreset(e.target.value)} disabled={busy} className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200">
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <button onClick={run} disabled={busy || !candidates.length} className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold disabled:opacity-60">
          {busy ? `Exporting… ${done}/${rows?.length ?? 0}` : 'Export & download zip'}
        </button>
        <span className="text-slate-500">Each clip keeps its own captions, headline and layout settings.</span>
      </div>
      {rows && (
        <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
          {rows.map((r) => (
            <li key={r.id} className="flex justify-between gap-3">
              <span className="truncate text-slate-300">{r.name}</span>
              <span className={r.state === 'done' ? 'text-emerald-300' : r.state === 'failed' ? 'text-rose-300' : 'text-amber-200'}>{r.state}{r.note ? `: ${r.note}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  )
}
