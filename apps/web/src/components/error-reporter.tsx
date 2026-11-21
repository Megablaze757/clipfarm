'use client'
import { useEffect } from 'react'
import { API_URL } from '@/lib/api'

/**
 * Reports crashes in people's browsers to the Worker (Admin → System shows
 * them). Message, a few stack lines and the page path only — nothing personal.
 * At most a handful per page view, so a crash loop can't flood anything.
 */
export function ErrorReporter() {
  useEffect(() => {
    let sent = 0
    const send = (message: string, stack?: string) => {
      if (sent >= 5 || !message || /ResizeObserver loop|Script error\.?$/i.test(message)) return
      sent++
      fetch(`${API_URL}/v1/telemetry/error`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ message: message.slice(0, 300), stack: (stack ?? '').slice(0, 800), path: window.location.pathname }),
      }).catch(() => {})
    }
    const onError = (e: ErrorEvent) => send(e.message, e.error?.stack)
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string; stack?: string } | string
      // API errors are shown to the user already; only report real crashes.
      if (typeof r === 'object' && r && 'status' in (r as object)) return
      send(typeof r === 'string' ? r : r?.message ?? 'Unhandled rejection', typeof r === 'object' ? r?.stack : undefined)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection) }
  }, [])
  return null
}
