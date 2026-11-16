import { supabase } from './supabase'

/** The merged apex-api Worker. Clipper's routes are under /v1. */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'https://apex-api.fitnessguru.workers.dev').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

export async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function apiFetch<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const isBody = options.body && typeof options.body === 'string'
  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      ...(isBody ? { 'Content-Type': 'application/json' } : {}),
      ...(await authHeader()),
      ...(options.headers as Record<string, string>),
    },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const err = data?.error
    throw new ApiError(res.status, err?.code ?? 'E_HTTP', err?.message ?? (typeof err === 'string' ? err : `Request failed (${res.status})`))
  }
  return data as T
}

export const api = {
  get: <T = any>(p: string) => apiFetch<T>(p),
  post: <T = any>(p: string, body?: unknown, headers?: Record<string, string>) =>
    apiFetch<T>(p, { method: 'POST', body: JSON.stringify(body ?? {}), headers }),
  patch: <T = any>(p: string, body: unknown) => apiFetch<T>(p, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T = any>(p: string) => apiFetch<T>(p, { method: 'DELETE' }),
}

// --- Shared shapes ---------------------------------------------------------------

export interface Project {
  id: string
  title: string
  source_kind: 'upload' | 'url'
  status: string
  progress?: number
  duration_ms: number | null
  error_code: string | null
  error_detail: string | null
  candidate_count: number
  top_score: number | null
  poster_url: string | null
  review_url?: string | null
  created_at: string
  updated_at: string
}

export interface CandidateRow {
  id: string
  project_id: string
  t_in_ms: number
  t_out_ms: number
  score: number
  subscores: Record<string, number>
  features: { badges?: string[]; signals?: string[]; unresolved?: string | null; title?: string; scorer?: string }
  rationale: string | null
  proxy_url: string | null
  thumb_url: string | null
  clip_id: string | null
  clip_status: string | null
}

export interface Plan {
  id: string
  label: string
  monthlyMinutes: number
  concurrentJobs: number
  watermark: boolean
  priceUsd: number | null
}
