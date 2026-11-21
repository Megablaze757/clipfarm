'use client'
import React, { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import { Loading, useSession } from '@/components/use-session'

/** Accept a team invite (the link in the "You're invited" email). */
function Accept() {
  const token = useSearchParams().get('token') ?? ''
  const session = useSession()
  const router = useRouter()
  const [state, setState] = useState<'ready' | 'joining' | 'done' | 'error'>('ready')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (session === null) router.replace(`/login?next=${encodeURIComponent(`/invite?token=${token}`)}`)
  }, [session, router, token])
  if (!session) return <Loading />

  async function join() {
    setState('joining')
    try { await api.post('/v1/team/accept', { token }); setState('done'); setTimeout(() => router.replace('/projects'), 1200) }
    catch (e) { setState('error'); setMsg((e as Error).message) }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="glass-panel rounded-2xl p-8 max-w-md w-full text-center space-y-4">
        <h1 className="text-2xl font-bold text-white">Join the workspace</h1>
        {state === 'done' ? <p className="text-sm text-emerald-300">You're in — taking you to the team's projects…</p> : (
          <>
            <p className="text-sm text-slate-300">You'll work on the team's projects and clips. Projects in your current personal workspace stay there.</p>
            {state === 'error' && <p className="text-sm text-rose-300">{msg}</p>}
            <button onClick={join} disabled={state === 'joining' || !token} className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-sm disabled:opacity-60">
              {state === 'joining' ? 'Joining…' : 'Accept invite'}
            </button>
            <Link href="/projects" className="block text-xs text-slate-400 underline">Not now</Link>
          </>
        )}
      </div>
    </div>
  )
}

export default function InvitePage() {
  return <Suspense fallback={<Loading />}><Accept /></Suspense>
}
