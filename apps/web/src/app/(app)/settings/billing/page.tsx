'use client'
import React, { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ErrorBox, Loading, useRequireSession } from '@/components/use-session'
import { api, type Plan } from '@/lib/api'

interface Usage {
  plan: Plan
  minutes_used: number
  minutes_included: number
  projects: number
  renders: number
  subscription: { status: string; current_period_end: string | null; cancel_at_period_end: boolean } | null
}

function Billing() {
  const session = useRequireSession()
  const params = useSearchParams()
  const [usage, setUsage] = useState<Usage | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [u, p] = await Promise.all([api.get<Usage>('/v1/usage'), api.get<{ plans: Plan[] }>('/v1/plans')])
      setUsage(u); setPlans(p.plans.filter((x) => x.priceUsd != null)); setError(null)
    } catch (e) { setError((e as Error).message) }
  }, [])
  useEffect(() => { if (session) load() }, [session, load])
  // The webhook can land a second or two after Stripe redirects back.
  useEffect(() => {
    if (!session || params.get('checkout') !== 'success') return
    const t = setTimeout(load, 3000)
    return () => clearTimeout(t)
  }, [session, params, load])

  async function go(path: string, body?: unknown, label = path) {
    setBusy(label); setError(null)
    try { const { url } = await api.post<{ url: string }>(path, body); window.location.href = url }
    catch (e) { setError((e as Error).message); setBusy(null) }
  }

  if (!session || (!usage && !error)) return <Loading />
  const pct = usage ? Math.min(100, (usage.minutes_used / Math.max(1, usage.minutes_included)) * 100) : 0

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      <div className="border-b border-slate-800/80 pb-6">
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Usage & billing</h1>
        <p className="text-slate-400 text-sm mt-1">You're billed on source minutes processed, not on clips — export as many as you like.</p>
      </div>
      {params.get('checkout') === 'success' && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">Thanks — your plan is updating.</div>}
      {error && <ErrorBox message={error} onRetry={load} />}
      {usage && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Source minutes this month</span>
            <div className="text-3xl font-black text-white">{usage.minutes_used} <span className="text-base text-slate-400 font-normal">/ {usage.minutes_included}</span></div>
            <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
              <div className={`h-full ${pct > 90 ? 'bg-rose-500' : 'bg-gradient-to-r from-indigo-500 to-purple-500'}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[11px] text-slate-500">{usage.projects} projects · {usage.renders} exports</p>
          </div>
          <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Plan</span>
            <div className="text-2xl font-black text-indigo-300">{usage.plan.label}</div>
            {usage.subscription?.current_period_end && (
              <p className="text-xs text-slate-400">{usage.subscription.cancel_at_period_end ? 'Ends' : 'Renews'} {new Date(usage.subscription.current_period_end).toLocaleDateString()}</p>
            )}
            {usage.subscription?.status === 'past_due' && <p className="text-xs text-rose-300">Payment failed — update your card in the portal.</p>}
          </div>
          <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-3 flex flex-col justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Invoices & card</span>
            <button onClick={() => go('/v1/billing/portal', undefined, 'portal')} disabled={busy != null || usage.plan.id === 'free'}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs rounded-xl border border-slate-700 disabled:opacity-50">
              {busy === 'portal' ? 'Opening…' : 'Open billing portal'}
            </button>
          </div>
        </div>
      )}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-white">Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {plans.map((p) => {
            const current = usage?.plan.id === p.id
            return (
              <div key={p.id} className={`glass-panel rounded-2xl p-5 border ${current ? 'border-indigo-500' : 'border-slate-800'} space-y-3`}>
                <div className="flex items-baseline justify-between"><h3 className="font-bold text-white">{p.label}</h3><span className="text-lg font-black text-white">${p.priceUsd}<span className="text-xs text-slate-400">/mo</span></span></div>
                <ul className="text-xs text-slate-300 space-y-1">
                  <li>{p.monthlyMinutes.toLocaleString()} source minutes / month</li>
                  <li>{p.concurrentJobs} project{p.concurrentJobs > 1 ? 's' : ''} at once</li>
                  <li>{p.watermark ? 'Watermarked exports, 3 clips per source' : 'No watermark, full shortlist'}</li>
                </ul>
                {p.id !== 'free' && !current && (
                  <button onClick={() => go('/v1/billing/checkout', { plan: p.id }, p.id)} disabled={busy != null || (usage?.plan.id !== 'free')}
                    className="w-full py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
                    title={usage?.plan.id !== 'free' ? 'Change plans from the billing portal' : undefined}>
                    {busy === p.id ? 'Opening Stripe…' : `Upgrade to ${p.label}`}
                  </button>
                )}
                {current && <div className="text-xs text-indigo-300 font-semibold">Current plan</div>}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

export default function BillingPage() {
  return <Suspense fallback={<Loading />}><Billing /></Suspense>
}
