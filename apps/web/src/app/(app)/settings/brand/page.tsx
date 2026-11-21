'use client'
import React, { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { ErrorBox, Loading, useRequireSession } from '@/components/use-session'
import { CAPTION_LOOKS, lookFor } from '@/lib/captions'

/**
 * BRAND KIT — your logo, caption colours, headline colours and default caption
 * style, applied to every export. The logo is shrunk here (≤ 400 px) and saved
 * with the kit, so it never expires.
 */
interface Brand {
  name?: string
  logo?: string | null
  logo_position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
  colors?: { active?: string; keyword?: string; headline_bg?: string; headline_text?: string }
  caption_style?: string
}

async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const scale = Math.min(1, 400 / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/png')
  } finally { URL.revokeObjectURL(url) }
}

export default function BrandPage() {
  const session = useRequireSession()
  const [brand, setBrand] = useState<Brand | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!session) return
    api.get<{ brand: Brand | null }>('/v1/brandkit').then((r) => setBrand(r.brand ?? { name: 'My brand', logo_position: 'top-right', colors: {}, caption_style: 'karaoke_yellow' })).catch((e) => setError((e as Error).message))
  }, [session])

  if (!session || (!brand && !error)) return <Loading />
  if (!brand) return <div className="max-w-2xl mx-auto px-6 py-16"><ErrorBox message={error ?? 'Could not load'} /></div>

  const set = (patch: Partial<Brand>) => { setBrand((b) => ({ ...(b ?? {}), ...patch })); setSaved(false) }
  const setColor = (k: keyof NonNullable<Brand['colors']>, v: string) => set({ colors: { ...(brand.colors ?? {}), [k]: v } })
  const look = lookFor(brand.caption_style ?? 'karaoke_yellow')
  const active = brand.colors?.active || look.active, keyword = brand.colors?.keyword || look.keyword || '#ffffff'

  async function save() {
    setBusy(true); setError(null)
    try { const r = await api.put<{ brand: Brand }>('/v1/brandkit', brand); setBrand(r.brand); setSaved(true) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const colorField = (k: keyof NonNullable<Brand['colors']>, label: string, fallback: string) => (
    <label className="flex items-center justify-between gap-3 text-xs text-slate-300">
      {label}
      <span className="flex items-center gap-2">
        <input type="color" value={brand.colors?.[k] || fallback} onChange={(e) => setColor(k, e.target.value)} className="w-9 h-7 bg-transparent" />
        {brand.colors?.[k] && <button type="button" onClick={() => setColor(k, '')} className="text-[10px] underline text-slate-500">reset</button>}
      </span>
    </label>
  )

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Brand kit</h1>
        <p className="text-sm text-slate-400 mt-1">Your logo and colours, on every clip you export.</p>
      </div>
      {error && <ErrorBox message={error} />}
      <div className="grid md:grid-cols-2 gap-6">
        <section className="glass-panel rounded-2xl p-5 border border-slate-800 space-y-4">
          <label className="block text-xs text-slate-400">Name
            <input value={brand.name ?? ''} onChange={(e) => set({ name: e.target.value })} className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200" />
          </label>
          <div className="text-xs text-slate-400 space-y-2">
            <div>Logo</div>
            <div className="flex items-center gap-3">
              {brand.logo ? <img src={brand.logo} alt="Logo" className="h-12 w-auto rounded bg-slate-800 p-1" /> : <span className="text-slate-500">None yet</span>}
              <label className="px-3 py-1.5 rounded-lg border border-dashed border-slate-700 text-slate-300 cursor-pointer hover:border-slate-500">
                Upload PNG / JPG
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) set({ logo: await shrink(f) }) }} />
              </label>
              {brand.logo && <button type="button" onClick={() => set({ logo: null })} className="underline text-slate-500">remove</button>}
            </div>
            <select value={brand.logo_position ?? 'top-right'} onChange={(e) => set({ logo_position: e.target.value as Brand['logo_position'] })} className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200">
              <option value="top-right">Top right</option><option value="top-left">Top left</option><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option>
            </select>
          </div>
          <div className="space-y-2">
            {colorField('active', 'Spoken word colour', look.active)}
            {colorField('keyword', 'Power-word colour', look.keyword ?? '#ffffff')}
            {colorField('headline_bg', 'Headline box', '#ffffff')}
            {colorField('headline_text', 'Headline text', '#000000')}
          </div>
          <div className="text-xs text-slate-400">Default caption style for new clips
            <div className="mt-1 flex flex-wrap gap-2">
              {CAPTION_LOOKS.map((l) => (
                <button key={l.id} type="button" onClick={() => set({ caption_style: l.id })}
                  className={`px-3 py-1.5 rounded-lg border ${brand.caption_style === l.id ? 'border-indigo-400 bg-indigo-500/15 text-white' : 'border-slate-700 text-slate-300'}`}>{l.label}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={busy} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-sm disabled:opacity-60">{busy ? 'Saving…' : 'Save brand kit'}</button>
            {saved && <span className="text-xs text-emerald-300">Saved — new exports use it.</span>}
          </div>
        </section>

        <section className="flex justify-center">
          <div className="relative w-[230px] h-[410px] rounded-2xl overflow-hidden border-2 border-slate-800 bg-gradient-to-br from-slate-600 via-slate-800 to-slate-900">
            <div className="absolute inset-x-3 top-[10%] flex flex-col items-center gap-[3px]">
              {['YOUR HEADLINE', 'GOES HERE'].map((l) => (
                <span key={l} className="text-[11px] px-1.5 py-0.5 leading-tight" style={{ background: brand.colors?.headline_bg || '#fff', color: brand.colors?.headline_text || '#000', fontFamily: 'Montserrat, sans-serif', fontWeight: 800 }}>{l}</span>
              ))}
            </div>
            {brand.logo && (
              <img src={brand.logo} alt="" className="absolute w-[14%]" style={{
                [brand.logo_position?.endsWith('left') ? 'left' : 'right']: '4%',
                [brand.logo_position?.startsWith('bottom') ? 'bottom' : 'top']: brand.logo_position?.startsWith('bottom') ? '20%' : '3%',
              }} />
            )}
            <div className="absolute inset-x-2 bottom-[22%] text-center">
              <span className="text-[15px]" style={{ fontFamily: look.font, fontWeight: look.weight, textShadow: '0 0 3px #000, 0 2px 4px #000' }}>
                <span style={{ color: '#fff' }}>{look.upper ? 'THIS IS ' : 'This is '}</span>
                <span style={{ color: active }}>{look.upper ? 'SO ' : 'so '}</span>
                <span style={{ color: keyword }}>{look.upper ? 'INSANE' : 'insane'}</span>
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
