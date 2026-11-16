import { API_URL, api, authHeader } from './api'

/**
 * Resumable multipart upload into R2 through the Worker (FR-1.1).
 *
 * Each part is retried on its own, and progress is saved in localStorage keyed
 * by the file's name/size/mtime — pick the same file again after a dropped
 * connection or a closed tab and it continues from the last finished part.
 */
interface Saved { key: string; upload_id: string; part_size: number; parts: { part: number; etag: string }[] }

const storeKey = (f: File) => `clipper-upload:${f.name}:${f.size}:${f.lastModified}`
const load = (f: File): Saved | null => {
  try { return JSON.parse(localStorage.getItem(storeKey(f)) || 'null') } catch { return null }
}
const save = (f: File, s: Saved | null) => {
  try { s ? localStorage.setItem(storeKey(f), JSON.stringify(s)) : localStorage.removeItem(storeKey(f)) } catch { /* private mode */ }
}

export async function uploadFile(file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<string> {
  let state = load(file)
  if (!state) {
    const created = await api.post<{ key: string; upload_id: string; part_size: number }>('/v1/upload/create', {
      filename: file.name, content_type: file.type || 'application/octet-stream', size: file.size,
    })
    state = { ...created, parts: [] }
    save(file, state)
  }
  const total = Math.max(1, Math.ceil(file.size / state.part_size))
  const done = new Set(state.parts.map((p) => p.part))
  onProgress(done.size / total)

  for (let n = 1; n <= total; n++) {
    if (done.has(n)) continue
    if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError')
    const blob = file.slice((n - 1) * state.part_size, Math.min(file.size, n * state.part_size))
    let lastErr: unknown
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetch(`${API_URL}/v1/upload/part?key=${encodeURIComponent(state.key)}&upload_id=${encodeURIComponent(state.upload_id)}&part=${n}`, {
          method: 'PUT', body: blob, headers: await authHeader(), signal,
        })
        if (res.status === 404 || res.status === 400) {
          // The upload session expired on R2's side: start over.
          save(file, null)
          throw new Error('Upload session expired — please pick the file again.')
        }
        if (!res.ok) throw new Error(`part ${n} failed (${res.status})`)
        const { etag } = await res.json()
        state.parts.push({ part: n, etag })
        save(file, state)
        lastErr = null
        break
      } catch (e) {
        lastErr = e
        if ((e as Error).name === 'AbortError' || /expired/.test(String(e))) throw e
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
      }
    }
    if (lastErr) throw lastErr
    onProgress(state.parts.length / total)
  }

  await api.post('/v1/upload/complete', { key: state.key, upload_id: state.upload_id, parts: state.parts })
  save(file, null)
  onProgress(1)
  return state.key
}
