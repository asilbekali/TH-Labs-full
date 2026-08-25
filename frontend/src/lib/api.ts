// Client for the dubbing API (FastAPI).
//
// The base comes from VITE_DUB_API and defaults to the relative "/api", which
// the Vite dev proxy and a single-origin reverse proxy both resolve to the
// pipeline server. Point it at a host (http://<ip>:8000/api) when the pipeline
// runs somewhere else.
//
// Everything under /jobs is AUTHENTICATED — the pipeline runs on a GPU and a
// job holds the user's uploaded video and its transcript, so backend/app/auth.py
// verifies the same bearer token the account API issues and scopes each job to
// its owner. Those calls go through authFetchUrl, which attaches the token and
// transparently refreshes it; /health and /languages are public and use plain
// fetch.
//
// Data shown in the UI comes from this API or from the account API — there is
// no mock/sample layer. When a call fails the caller surfaces the failure
// rather than substituting invented content.
import { authFetchUrl, getAccessToken } from './http'
import type { Health, Job, JobEvent, Language } from './types'

const BASE: string = import.meta.env.VITE_DUB_API ?? '/api'

// The language catalog is served by GET /languages. This copy is the same list
// the backend ships (backend/app/languages.py) and exists only so the target
// picker still works when the pipeline server is unreachable — real codes, not
// placeholder content.
export const FALLBACK_LANGUAGES: Language[] = [
  { code: 'en', name: 'English', native: 'English', flag: '🇬🇧', whisper: 'en', nllb: 'eng_Latn' },
  { code: 'es', name: 'Spanish', native: 'Español', flag: '🇪🇸', whisper: 'es', nllb: 'spa_Latn' },
  { code: 'fr', name: 'French', native: 'Français', flag: '🇫🇷', whisper: 'fr', nllb: 'fra_Latn' },
  { code: 'de', name: 'German', native: 'Deutsch', flag: '🇩🇪', whisper: 'de', nllb: 'deu_Latn' },
  { code: 'ru', name: 'Russian', native: 'Русский', flag: '🇷🇺', whisper: 'ru', nllb: 'rus_Cyrl' },
  { code: 'uz', name: 'Uzbek', native: 'Oʻzbek', flag: '🇺🇿', whisper: 'uz', nllb: 'uzn_Latn' },
  { code: 'it', name: 'Italian', native: 'Italiano', flag: '🇮🇹', whisper: 'it', nllb: 'ita_Latn' },
  { code: 'pt', name: 'Portuguese', native: 'Português', flag: '🇵🇹', whisper: 'pt', nllb: 'por_Latn' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe', flag: '🇹🇷', whisper: 'tr', nllb: 'tur_Latn' },
  { code: 'ar', name: 'Arabic', native: 'العربية', flag: '🇸🇦', whisper: 'ar', nllb: 'arb_Arab' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', flag: '🇮🇳', whisper: 'hi', nllb: 'hin_Deva' },
  { code: 'zh', name: 'Chinese', native: '中文', flag: '🇨🇳', whisper: 'zh', nllb: 'zho_Hans' },
  { code: 'ja', name: 'Japanese', native: '日本語', flag: '🇯🇵', whisper: 'ja', nllb: 'jpn_Jpan' },
  { code: 'ko', name: 'Korean', native: '한국어', flag: '🇰🇷', whisper: 'ko', nllb: 'kor_Hang' },
]

export async function getHealth(): Promise<Health> {
  const r = await fetch(`${BASE}/health`)
  if (!r.ok) throw new Error('Could not reach the dubbing service')
  return r.json()
}

export async function getLanguages(): Promise<Language[]> {
  const r = await fetch(`${BASE}/languages`)
  if (!r.ok) throw new Error('Could not load the language catalog')
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

  const r = await authFetchUrl(`${BASE}/jobs`, { method: 'POST', body: fd })
  if (r.status === 401) throw new AuthRequiredError()
  if (!r.ok) {
    const msg = await r.text().catch(() => '')
    throw new Error(`job creation failed: ${r.status} ${msg}`)
  }
  return (await r.json()).job
}

export async function getJob(jobId: string): Promise<Job> {
  const r = await authFetchUrl(`${BASE}/jobs/${jobId}`)
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
  // EventSource cannot set headers — the browser API takes a URL and nothing
  // else — so the SSE route also accepts ?access_token= (see
  // backend/app/auth.py:require_user_sse). Only the short-lived access token
  // goes here, never anything longer-lived, and the request is same-origin.
  // Safe to read synchronously: callers subscribe immediately after createJob,
  // which has just refreshed the token through authFetchUrl.
  const token = getAccessToken()
  const es = new EventSource(
    `${BASE}/jobs/${jobId}/events` +
      (token ? `?access_token=${encodeURIComponent(token)}` : ''),
  )
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

// Media paths from the API are relative to the dubbing API's own origin, so
// they need the same base prepended when VITE_DUB_API points off-origin.
export function mediaUrl(path: string | null): string | undefined {
  if (!path) return undefined
  if (/^https?:\/\//.test(path) || BASE.startsWith('/')) return path
  return new URL(path, BASE).toString()
}
