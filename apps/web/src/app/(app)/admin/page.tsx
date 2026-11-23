'use client'
import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { useSession, Loading, ErrorBox } from '@/components/use-session'
import { useMe } from '@/components/use-me'

/**
 * ADMIN PANEL — one page, several jobs, one tab at a time (the
 * FootballFitnessGuru layout). The tab you were on is remembered; #people etc.
 * links straight to a tab. Every action is re-checked on the Worker — this
 * page only decides what to show.
 */
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'people', label: 'People' },
  { id: 'payments', label: 'Payments' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'settings', label: 'Settings' },
  { id: 'system', label: 'System' },
] as const
type Tab = (typeof TABS)[number]['id']
const PLAN_IDS = ['free', 'creator', 'team', 'agency', 'enterprise']

const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const fmtAgo = (s?: string | null) => {
  if (!s) return '—'
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000)
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="glass-panel rounded-2xl p-4 border border-slate-800">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-2xl font-extrabold text-white mt-1">{value}</div>
      {hint && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
    </div>
  )
}

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => { setError(null); api.get<T>(path).then(setData).catch((e) => setError((e as Error).message)) }, [path])
  useEffect(() => { load() }, [load])
  return { data, error, load }
}

/** Reminder until launch: guest mode lets anyone use Clipper free. */
function GuestBanner({ onFix }: { onFix: () => void }) {
  const { data } = useLoad<{ guest_mode: boolean }>('/v1/admin/settings')
  if (!data?.guest_mode) return null
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-100 flex flex-wrap items-center justify-between gap-3">
      <span><strong>Guest mode is on</strong> — anyone can use Clipper free, without an account or plan limits. Turn it off before you launch.</span>
      <button onClick={onFix} className="underline font-semibold">Settings</button>
    </div>
  )
}

function Overview() {
  const { data: d, error, load } = useLoad<any>('/v1/admin/overview')
  if (error) return <ErrorBox message={error} onRetry={load} />
  if (!d) return <Loading />
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Users" value={d.users} hint={`+${d.new_users_this_month} this month`} />
        <Stat label="Paying" value={d.paying} hint={`$${d.mrr_usd.toLocaleString()}/mo MRR`} />
        <Stat label="Minutes processed" value={d.minutes_this_month.toLocaleString()} hint="this month" />
        <Stat label="Projects" value={d.projects_this_month} hint={`${d.exports_this_month} exports this month`} />
        <Stat label="Processing now" value={d.processing_now} />
        <Stat label="Failed (24 h)" value={<span className={d.failed_last_24h ? 'text-rose-300' : ''}>{d.failed_last_24h}</span>} hint="see Jobs" />
        <Stat label="Workspaces" value={d.workspaces} hint={Object.entries(d.workspaces_by_plan).map(([p, n]) => `${p} ${n}`).join(' · ')} />
        <Stat label="Guest mode" value={d.guest_mode ? 'On' : 'Off'} hint={d.guest_mode ? 'anyone can use it without an account' : 'sign-in required'} />
      </div>
    </div>
  )
}

function People() {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const { data, error, load } = useLoad<{ users: any[] }>(`/v1/admin/users${query ? `?q=${encodeURIComponent(query)}` : ''}`)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 350); return () => clearTimeout(t) }, [q])

  async function setPlan(tenantId: string, plan: string, email: string) {
    if (!confirm(`Put ${email}'s workspace on the ${plan} plan? This doesn't charge or refund anything in Stripe.`)) return
    setBusy(tenantId); setNote(null)
    try { await api.post(`/v1/admin/workspaces/${tenantId}/plan`, { plan }); setNote(`${email} → ${plan}`); load() }
    catch (e) { setNote((e as Error).message) }
    finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email…" className="w-full md:w-80 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100" />
      {note && <p className="text-xs text-emerald-300">{note}</p>}
      {error && <ErrorBox message={error} onRetry={load} />}
      {!data && !error && <Loading />}
      {data && (
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full text-xs">
            <thead className="bg-slate-900/80 text-slate-400 text-left">
              <tr><th className="p-3">Email</th><th className="p-3">Plan</th><th className="p-3">Subscription</th><th className="p-3 text-right">Minutes (month)</th><th className="p-3 text-right">Projects</th><th className="p-3">Joined</th></tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id} className="border-t border-slate-800/80">
                  <td className="p-3 text-slate-100">{u.email || <span className="text-slate-500">(no email)</span>}{u.role !== 'owner' && <span className="ml-1 text-slate-500">({u.role})</span>}</td>
                  <td className="p-3">
                    <select value={u.plan} disabled={busy === u.tenant_id} onChange={(e) => setPlan(u.tenant_id, e.target.value, u.email)} className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-200">
                      {PLAN_IDS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                  <td className="p-3 text-slate-300">{u.subscription ? `${u.subscription.status}${u.subscription.cancel_at_period_end ? ' (cancelling)' : ''}` : '—'}</td>
                  <td className="p-3 text-right text-slate-300">{u.minutes_this_month}</td>
                  <td className="p-3 text-right text-slate-300">{u.projects}</td>
                  <td className="p-3 text-slate-400">{fmtDate(u.joined)}</td>
                </tr>
              ))}
              {!data.users.length && <tr><td colSpan={6} className="p-6 text-center text-slate-500">No one matches.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-slate-500">Changing a plan here is a manual override (comps, fixes). Paid plans normally change through Stripe checkout and the billing portal.</p>
    </div>
  )
}

function Payments() {
  const { data, error, load } = useLoad<any>('/v1/admin/payments')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  async function setup() {
    if (!confirm(`Create Clipper's product, monthly prices and webhook in your Stripe account (${data?.stripe?.mode ?? 'unknown'} mode)? Nothing is charged.`)) return
    setBusy(true); setMsg(null)
    try { await api.post('/v1/admin/payments/setup', {}); setMsg('Payments are set up — Creator, Team and Agency checkouts now work.'); load() }
    catch (e) { setMsg((e as Error).message) }
    finally { setBusy(false) }
  }
  if (error) return <ErrorBox message={error} onRetry={load} />
  if (!data) return <Loading />
  const s = data.stripe
  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-2xl p-5 border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white">Stripe</h3>
            <p className="text-xs text-slate-400 mt-1">
              {!s.key_present ? 'No Stripe key on the Worker.' : s.set_up ? `Set up${s.set_up_at ? ` ${fmtDate(s.set_up_at)}` : ''} · ${s.mode} mode` : `Key found (${s.mode} mode) — not set up yet.`}
            </p>
          </div>
          {s.key_present && (
            <button onClick={setup} disabled={busy} className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-xs disabled:opacity-60">
              {busy ? 'Setting up…' : s.set_up ? 'Re-check setup' : 'Set up payments'}
            </button>
          )}
        </div>
        {s.mode === 'test' && <p className="text-[11px] text-amber-200">Test mode: checkouts use Stripe test cards and nobody is charged.</p>}
        {msg && <p className="text-xs text-emerald-300">{msg}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          {data.plans.filter((p: any) => p.price_usd).map((p: any) => (
            <div key={p.id} className="rounded-xl border border-slate-800 p-3">
              <div className="font-semibold text-white">{p.label} · ${p.price_usd}/mo</div>
              <div className="text-slate-400">{p.minutes.toLocaleString()} min/month</div>
              <div className={`mt-1 ${s.prices[p.id] ? 'text-emerald-300' : 'text-slate-500'}`}>{s.prices[p.id] ? 'Price ready' : 'No price yet'}</div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3 className="text-sm font-bold text-white mb-2">Subscriptions</h3>
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full text-xs">
            <thead className="bg-slate-900/80 text-slate-400 text-left"><tr><th className="p-3">Owner</th><th className="p-3">Status</th><th className="p-3">Renews / ends</th><th className="p-3">Updated</th></tr></thead>
            <tbody>
              {data.subscriptions.map((x: any) => (
                <tr key={`${x.tenant_id}-${x.updated_at}`} className="border-t border-slate-800/80">
                  <td className="p-3 text-slate-100">{x.email ?? x.tenant_id}</td>
                  <td className="p-3 text-slate-300">{x.status}{x.cancel_at_period_end ? ' (cancelling)' : ''}</td>
                  <td className="p-3 text-slate-400">{fmtDate(x.current_period_end)}</td>
                  <td className="p-3 text-slate-400">{fmtAgo(x.updated_at)}</td>
                </tr>
              ))}
              {!data.subscriptions.length && <tr><td colSpan={4} className="p-6 text-center text-slate-500">No subscriptions yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Jobs() {
  const { data, error, load } = useLoad<{ projects: any[]; failed_exports: any[] }>('/v1/admin/jobs')
  const [busy, setBusy] = useState<string | null>(null)
  async function retry(id: string) {
    setBusy(id)
    try { await api.post(`/v1/admin/projects/${id}/retry`, {}); load() } catch (e) { alert((e as Error).message) } finally { setBusy(null) }
  }
  if (error) return <ErrorBox message={error} onRetry={load} />
  if (!data) return <Loading />
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={load} className="text-xs underline text-slate-400">Refresh</button></div>
      <div className="overflow-x-auto rounded-2xl border border-slate-800">
        <table className="w-full text-xs">
          <thead className="bg-slate-900/80 text-slate-400 text-left"><tr><th className="p-3">Project</th><th className="p-3">Status</th><th className="p-3">Length</th><th className="p-3">Started</th><th className="p-3"></th></tr></thead>
          <tbody>
            {data.projects.map((p) => (
              <tr key={p.id} className="border-t border-slate-800/80 align-top">
                <td className="p-3 text-slate-100 max-w-[320px]">
                  <div className="truncate">{p.title}</div>
                  {p.error_code && <div className="text-rose-300 mt-0.5 break-words">{p.error_code}: {String(p.error_detail ?? '').slice(0, 160)}</div>}
                </td>
                <td className={`p-3 ${p.status === 'failed' ? 'text-rose-300' : p.status === 'ready' ? 'text-emerald-300' : 'text-amber-200'}`}>{p.status}{p.status !== 'ready' && p.status !== 'failed' ? ` ${p.progress ?? 0}%` : ''}</td>
                <td className="p-3 text-slate-400">{p.duration_ms ? `${(p.duration_ms / 3_600_000).toFixed(1)} h` : '—'}</td>
                <td className="p-3 text-slate-400">{fmtAgo(p.created_at)}</td>
                <td className="p-3 text-right">{p.status === 'failed' && <button disabled={busy === p.id} onClick={() => retry(p.id)} className="text-indigo-300 underline">{busy === p.id ? '…' : 'Retry'}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!!data.failed_exports.length && (
        <div>
          <h3 className="text-sm font-bold text-white mb-2">Failed exports</h3>
          <ul className="text-xs space-y-1">
            {data.failed_exports.map((r) => <li key={r.id} className="text-rose-300">{fmtAgo(r.queued_at)} · {r.preset} · {r.error_code}: {String(r.error_detail ?? '').slice(0, 160)}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

function Settings() {
  const { data, error, load } = useLoad<{ guest_mode: boolean; guest_mode_forced_off: boolean; home_runner: string }>('/v1/admin/settings')
  const [busy, setBusy] = useState(false)
  async function toggle(on: boolean) {
    if (!on && !confirm('Turn guest mode off? Everyone will need an account to use Clipper.')) return
    setBusy(true)
    try { await api.patch('/v1/admin/settings', { guest_mode: on }); load() } catch (e) { alert((e as Error).message) } finally { setBusy(false) }
  }
  if (error) return <ErrorBox message={error} onRetry={load} />
  if (!data) return <Loading />
  return (
    <section className="glass-panel rounded-2xl p-5 border border-slate-800 space-y-3 max-w-xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-white">Guest mode</h3>
          <p className="text-xs text-slate-400 mt-1">On: anyone can use Clipper without an account, in one shared workspace. Off: sign-in required, and free/paid plan limits apply to everyone.</p>
        </div>
        <button disabled={busy || data.guest_mode_forced_off} onClick={() => toggle(!data.guest_mode)}
          className={`shrink-0 px-4 py-2 rounded-xl text-xs font-bold ${data.guest_mode ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40' : 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'} disabled:opacity-60`}>
          {data.guest_mode ? 'On — turn off' : 'Off — turn on'}
        </button>
      </div>
      {data.guest_mode_forced_off && <p className="text-[11px] text-slate-500">Forced off by CLIPPER_GUEST_MODE on the Worker.</p>}
      <div className="border-t border-slate-800 pt-4 space-y-2">
        <h3 className="text-sm font-bold text-white">Run jobs on my computer</h3>
        <p className="text-xs text-slate-400">YouTube blocks GitHub's servers but not home connections. Register your PC as a GitHub self-hosted runner (guide: docs/home-runner.md in the repo), then choose what goes to it. Jobs sent to it wait until your computer is on.</p>
        <select value={data.home_runner} disabled={busy} onChange={async (e) => { setBusy(true); try { await api.patch('/v1/admin/settings', { home_runner: e.target.value }); load() } finally { setBusy(false) } }}
          className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200">
          <option value="off">Off — GitHub's runners only</option>
          <option value="youtube">YouTube links only</option>
          <option value="all">All jobs</option>
        </select>
        <a href="https://github.com/Megablaze757/clipfarm/blob/main/docs/home-runner.md" target="_blank" rel="noreferrer" className="block text-[11px] text-indigo-300 underline">How to set up the runner</a>
      </div>
    </section>
  )
}

function System() {
  const { data, error, load } = useLoad<any>('/v1/admin/system')
  if (error) return <ErrorBox message={error} onRetry={load} />
  if (!data) return <Loading label="Testing keys…" />
  const Row = ({ ok, title, detail, fix }: { ok: boolean | null; title: string; detail: string; fix?: string }) => (
    <div className="flex items-start gap-3 py-3 border-b border-slate-800/80 last:border-0">
      <span className={`mt-0.5 text-sm ${ok ? 'text-emerald-300' : ok === null ? 'text-slate-500' : 'text-rose-300'}`}>{ok ? '●' : ok === null ? '○' : '●'}</span>
      <div className="min-w-0">
        <div className="text-sm text-white font-semibold">{title}</div>
        <div className="text-xs text-slate-400">{detail}</div>
        {!ok && fix && <div className="text-[11px] text-amber-200 mt-1">{fix}</div>}
      </div>
    </div>
  )
  const ai = (k: string, name: string) => {
    const x = data.ai[k]
    return <Row key={k} ok={x.works} title={name} detail={`${x.role} — ${!x.set ? 'no key set' : x.works ? 'key works' : `key REJECTED (${x.status ?? 'no response'})`}`} fix={x.fix} />
  }
  return (
    <div className="space-y-6 max-w-3xl">
      <section className="glass-panel rounded-2xl p-5 border border-slate-800">
        <h3 className="text-sm font-bold text-white mb-1">AI keys (tested just now)</h3>
        <p className="text-xs text-slate-400 mb-2">Transcription is using: <span className="text-slate-200">{data.transcription}</span></p>
        {ai('groq', 'Groq')}{ai('openrouter', 'OpenRouter')}{ai('nvidia', 'NVIDIA')}
        {data.ai_last_failure && (
          <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
            <div className="text-xs font-bold text-rose-200">Last time every AI model failed: {new Date(data.ai_last_failure.last_failure_at).toLocaleString()}</div>
            <div className="text-[11px] text-rose-100/80 mt-1 break-words">{String(data.ai_last_failure.error).slice(0, 600)}</div>
            <div className="text-[11px] text-slate-400 mt-1">A key can work and its model still be retired (“410 Gone”) — the reason above says which.</div>
          </div>
        )}
      </section>
      <section className="glass-panel rounded-2xl p-5 border border-slate-800">
        <h3 className="text-sm font-bold text-white mb-1">Everything else</h3>
        <Row ok={!!data.email.provider} title="Email" detail={data.email.provider ? `Sending with ${data.email.provider}${data.email.from ? ` as ${data.email.from}` : ' as "Clipper"'}` : 'No email provider'} fix="Set GAS_EMAIL_URL + GAS_EMAIL_SECRET, or RESEND_API_KEY, on the Worker." />
        <Row ok={data.payments.stripe_key} title="Stripe" detail={data.payments.stripe_key ? 'Key present — set up prices in Payments' : 'No Stripe key'} fix="Set STRIPE_SECRET_KEY on the Worker." />
        <Row ok={data.admins > 0} title="Admins" detail={`${data.admins} admin email(s) configured`} />
        {(['youtube', 'tiktok', 'instagram'] as const).map((p) => (
          <Row key={p} ok={data.posting[p] ? true : null} title={`Posting: ${p === 'youtube' ? 'YouTube Shorts' : p === 'tiktok' ? 'TikTok' : 'Instagram Reels'}`}
            detail={data.posting[p] ? 'App keys set — users can connect' : 'Not set up (optional)'}
            fix={p === 'youtube' ? `Google Cloud → OAuth client (Web), enable YouTube Data API v3, redirect URI ${data.posting.redirect_uri_pattern.replace('<youtube|tiktok|instagram>', 'youtube')}; set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.`
              : p === 'tiktok' ? `developers.tiktok.com → app with Login Kit + Content Posting API (video.upload), redirect URI ${data.posting.redirect_uri_pattern.replace('<youtube|tiktok|instagram>', 'tiktok')}; set TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET.`
              : `developers.facebook.com → app with Instagram Graph API + Facebook Login, redirect URI ${data.posting.redirect_uri_pattern.replace('<youtube|tiktok|instagram>', 'instagram')}; set META_APP_ID / META_APP_SECRET.`} />
        ))}
      </section>
      <button onClick={load} className="text-xs underline text-slate-400">Test again</button>
      <ClientErrors />
    </div>
  )
}

/** Crashes reported from people's browsers (components/error-reporter.tsx). */
function ClientErrors() {
  const { data } = useLoad<{ errors: { message: string; path?: string; count: number; last: string; stack?: string }[] }>('/v1/admin/client-errors')
  if (!data) return null
  return (
    <section className="glass-panel rounded-2xl p-5 border border-slate-800">
      <h3 className="text-sm font-bold text-white mb-2">Recent errors in people's browsers</h3>
      {!data.errors.length ? <p className="text-xs text-slate-400">None reported. 🎉</p> : (
        <ul className="space-y-2 text-xs">
          {data.errors.slice(0, 25).map((e, i) => (
            <li key={i} className="border-b border-slate-800/80 pb-2">
              <div className="text-rose-200 break-words">{e.message}</div>
              <div className="text-[11px] text-slate-500">{e.path} · {e.count}× · last {fmtAgo(e.last)}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function AdminPage() {
  const session = useSession()
  const me = useMe()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overview')

  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    let remembered: string | null = null
    try { remembered = localStorage.getItem('clipper-admin-tab') } catch { /* private mode */ }
    const pick = [hash, remembered].find((t) => TABS.some((x) => x.id === t))
    if (pick) setTab(pick as Tab)
  }, [])
  useEffect(() => { if (session === null) router.replace('/login?next=/admin') }, [session, router])

  const choose = (t: Tab) => {
    setTab(t)
    try { localStorage.setItem('clipper-admin-tab', t) } catch { /* ignore */ }
    window.history.replaceState({}, '', `#${t}`)
  }

  if (!session || !me) return <Loading />
  if (!me.is_admin) {
    return <div className="max-w-xl mx-auto px-6 py-16 text-center text-sm text-slate-400">This page is for admins. <Link href="/projects" className="underline text-indigo-300">Back to projects</Link></div>
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Admin</h1>
          <p className="text-xs text-slate-400 mt-1">Signed in as {me.email}</p>
        </div>
        <nav className="flex flex-wrap gap-1 bg-slate-900/80 border border-slate-800 p-1 rounded-xl text-xs font-medium" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => choose(t.id)}
              className={`px-3 py-1.5 rounded-lg ${tab === t.id ? 'bg-slate-700 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'}`}>{t.label}</button>
          ))}
        </nav>
      </div>
      <GuestBanner onFix={() => choose('settings')} />
      {tab === 'overview' && <Overview />}
      {tab === 'people' && <People />}
      {tab === 'payments' && <Payments />}
      {tab === 'jobs' && <Jobs />}
      {tab === 'settings' && <Settings />}
      {tab === 'system' && <System />}
    </div>
  )
}
