// Thin API client. Uses relative URLs so the Vite proxy (dev) and a reverse
// proxy (prod) both resolve to the FastAPI backend.
//
// Everything under /api/jobs is authenticated — the pipeline runs on a GPU and
// jobs hold the user's uploaded video and its transcript. Those calls go
// through authFetch, which attaches the access token and transparently
// refreshes it; /api/health and /api/languages stay public and use plain fetch.
import { authFetch, withAccessToken } from './auth'
import type { Health, Job, JobEvent, Language } from './types'

const BASE = '/api'

/**
 * The session expired or was revoked mid-flight and could not be refreshed.
 * Callers surface this as "sign in again" rather than a generic failure.
 */
export class AuthRequiredError extends Error {
  constructor() {
    super('Your session has expired. Sign in again to continue.')
    this.name = 'AuthRequiredError'
  }
}

export async function getHealth(): Promise<Health> {
  const r = await fetch(`${BASE}/health`)
  if (!r.ok) throw new Error('health failed')
  return r.json()
}

export async function getLanguages(): Promise<Language[]> {
  const r = await fetch(`${BASE}/languages`)
  if (!r.ok) throw new Error('languages failed')
  return (await r.json()).languages
}

export interface CreateJobInput {
  target_lang: string
  source_lang?: string
  voice_clone?: boolean
  lip_sync?: boolean
  keep_background?: boolean
  quality?: string
  sample?: boolean
  file?: File | null
}

export async function createJob(input: CreateJobInput): Promise<Job> {
  const fd = new FormData()
  fd.append('target_lang', input.target_lang)
  fd.append('source_lang', input.source_lang ?? 'auto')
  fd.append('voice_clone', String(input.voice_clone ?? true))
  fd.append('lip_sync', String(input.lip_sync ?? false))
  fd.append('keep_background', String(input.keep_background ?? true))
  fd.append('quality', input.quality ?? 'balanced')
  fd.append('sample', String(input.sample ?? false))
  if (input.file) fd.append('file', input.file)

  const r = await authFetch(`${BASE}/jobs`, { method: 'POST', body: fd })
  if (r.status === 401) throw new AuthRequiredError()
  if (!r.ok) {
    const msg = await r.text().catch(() => '')
    throw new Error(`job creation failed: ${r.status} ${msg}`)
  }
  return (await r.json()).job
}

export async function getJob(jobId: string): Promise<Job> {
  const r = await authFetch(`${BASE}/jobs/${jobId}`)
  if (r.status === 401) throw new AuthRequiredError()
  if (!r.ok) throw new Error('job fetch failed')
  return (await r.json()).job
}

// Poll job status on an interval until it finishes. Returns a stop() fn.
export function pollJob(
  jobId: string,
  onUpdate: (job: Job) => void,
  intervalMs = 3000,
): () => void {
  let stopped = false
  const tick = async () => {
    if (stopped) return
    try {
      const job = await getJob(jobId)
      onUpdate(job)
      if (job.status === 'completed' || job.status === 'failed') return
    } catch {
      /* keep polling */
    }
    if (!stopped) setTimeout(tick, intervalMs)
  }
  setTimeout(tick, intervalMs)
  return () => {
    stopped = true
  }
}

// Subscribe to live pipeline progress via Server-Sent Events.
export function subscribeJob(
  jobId: string,
  onEvent: (evt: JobEvent) => void,
  onError?: () => void,
): () => void {
  // EventSource cannot set headers, so the token rides in the query string —
  // see withAccessToken and backend/app/auth.py:require_user_sse for why that
  // is acceptable here and nowhere else.
  const es = new EventSource(withAccessToken(`${BASE}/jobs/${jobId}/events`))
  es.onmessage = (e) => {
    try {
      const evt: JobEvent = JSON.parse(e.data)
      onEvent(evt)
      if (evt.final) es.close()
    } catch {
      /* ignore malformed frames */
    }
  }
  es.onerror = () => {
    es.close()
    onError?.()
  }
  return () => es.close()
}

// media URLs coming back from the API are already same-origin-relative.
export function mediaUrl(path: string | null): string | undefined {
  return path ?? undefined
}
