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
// transparently refreshes it.
//
// health and languages do NOT live here any more. They used to be fetched from
// the pipeline directly, which meant a sleeping GPU box took the language
// picker and the whole status strip down with it — /api/health and
// /api/languages returned 502 through the dev proxy and the app rendered as if
// the entire service were gone. Both are now served by the account API
// (https://th-labs.uz, documented at /docs, routes under /v1), which is up
// whenever the site is: GET /v1/languages reads the catalog from its database,
// and GET /v1/health reports the API, its database, and — by probing it
// server-side — the pipeline.
//
// Data shown in the UI comes from these APIs — there is no mock/sample layer.
// When a call fails the caller surfaces the failure rather than substituting
// invented content.
import { apiUrl, authFetchUrl, getAccessToken } from './http'
import type { Health, Job, JobEvent, Language } from './types'

const BASE: string = import.meta.env.VITE_DUB_API ?? '/api'

// The language catalog is served by GET /v1/languages. This copy is a subset of
// the same list the account API seeds (api/prisma/seed.ts, itself taken from
// backend/app/languages.py) and exists only so the target picker still works
// while the first request is in flight — real codes, not placeholder content.
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

// GET /v1/health. Public, so plain fetch — but through apiUrl so it follows
// VITE_ACCOUNT_API like every other account-API call.
//
// A failure here means the ACCOUNT API is unreachable, which is a much bigger
// deal than a sleeping pipeline. A pipeline that is merely down still resolves
// this call: read `pipeline` on the response, not the query's error state (see
// pipelineDown).
export async function getHealth(): Promise<Health> {
  const r = await fetch(apiUrl('/health'))
  if (!r.ok) throw new Error('Could not reach the TH-LABS API')
  return r.json()
}

// GET /v1/languages — the catalog, from the account API's database.
export async function getLanguages(): Promise<Language[]> {
  const r = await fetch(apiUrl('/languages'))
  if (!r.ok) throw new Error('Could not load the language catalog')
  return (await r.json()).languages
}

/**
 * Whether the dubbing pipeline is unusable right now.
 *
 * Two distinct failures read the same to a user — "nothing can be dubbed" — but
 * arrive differently: the account API being unreachable errors the query, while
 * a sleeping pipeline comes back as a perfectly good 200 with pipeline: 'down'.
 * `undefined` is treated as up so a build pointed straight at the FastAPI
 * pipeline (which has no such field) still behaves as before.
 */
export function pipelineDown(health: Health | null | undefined, queryFailed: boolean): boolean {
  if (queryFailed) return true
  if (!health) return false
  return health.pipeline !== undefined && health.pipeline !== 'up'
}

export interface CreateJobInput {
  target_lang: string
  source_lang?: string
  voice_clone?: boolean
  /**
   * Whose voice, and in what accent — 'both' (their timbre, native accent),
   * 'speaker' (their voice and their accent) or 'native' (a target-language
   * voice, nothing kept).
   *
   * Sent alongside `voice_clone` rather than replacing it: the pipeline still
   * branches on the boolean, and the mode refines what it does when cloning.
   */
  voice_mode?: string
  /**
   * Optional clip of a DIFFERENT voice to dub in, instead of the speaker in
   * the source. Only sent when the mode clones a voice at all.
   */
  reference?: File | null
  lip_sync?: boolean
  keep_background?: boolean
  quality?: string
  sample?: boolean
  file?: File | null
  /**
   * A public video link to dub instead of an upload (YouTube, Vimeo, TikTok, or
   * a direct .mp4). The server fetches it — see backend/app/pipeline/fetch.py,
   * which vets the URL and enforces the size/duration caps.
   *
   * Mutually exclusive with `file`: sending both is a 400, on purpose, because
   * silently picking one is how someone dubs the wrong video.
   */
  source_url?: string | null
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

/**
 * The dub was refused for want of credits (HTTP 402).
 *
 * Typed separately because it is the one failure with a fix the user can act on
 * themselves, and the UI has to offer that fix — a buy-credits route — rather
 * than printing a sentence into an error box. Everything else that can go wrong
 * with a job is a plain Error.
 */
export class PaymentRequiredError extends Error {
  constructor(message: string) {
    super(message || 'You need more credits to dub this video.')
    this.name = 'PaymentRequiredError'
  }
}

export async function createJob(input: CreateJobInput): Promise<Job> {
  const fd = new FormData()
  fd.append('target_lang', input.target_lang)
  fd.append('source_lang', input.source_lang ?? 'auto')
  fd.append('voice_clone', String(input.voice_clone ?? true))
  // Both optional on the pipeline, so only sent when set — an older backend
  // that does not know these fields simply never sees them.
  if (input.voice_mode) fd.append('voice_mode', input.voice_mode)
  if (input.reference) fd.append('reference', input.reference)
  fd.append('lip_sync', String(input.lip_sync ?? false))
  fd.append('keep_background', String(input.keep_background ?? true))
  fd.append('quality', input.quality ?? 'balanced')
  fd.append('sample', String(input.sample ?? false))
  if (input.file) fd.append('file', input.file)
  // Only ever one source on the request. The server rejects both together, so
  // the guard here is what keeps that 400 unreachable from the UI.
  else if (input.source_url) fd.append('source_url', input.source_url)

  const r = await authFetchUrl(`${BASE}/jobs`, { method: 'POST', body: fd })
  if (r.status === 401) throw new AuthRequiredError()
  if (!r.ok) {
    // A 400 from a link job carries a sentence written for the person who
    // pasted it ("that video is private", "that's a live stream"), in FastAPI's
    // `{detail: "…"}`. Showing `job creation failed: 400 {"detail":…}` instead
    // throws away the only part of the response that tells them what to do.
    const raw = await r.text().catch(() => '')
    let detail = ''
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.detail === 'string') detail = parsed.detail
    } catch {
      /* not JSON — fall through to the raw body */
    }
    // 402 is the one status with a fix the user can act on themselves, so it
    // gets its own type and the Studio offers the fix instead of printing the
    // sentence into an error box.
    if (r.status === 402) throw new PaymentRequiredError(detail)
    if (detail) throw new Error(detail)
    throw new Error(`job creation failed: ${r.status} ${raw}`)
  }
  return (await r.json()).job
}

// Re-voice a finished job with a corrected translation. Only the TARGET text is
// editable — the source column is what Whisper heard, and the dub is
// synthesized from the target side alone, so rewriting the source would change
// nothing anyone hears while making the two columns disagree about the same
// audio.
//
// The backend starts a NEW job from the stored source video and skips ASR and
// NMT, so the original stays playable while the correction renders. Returns the
// new job to subscribe to.
export async function revoiceJob(
  jobId: string,
  segments: { id: number; target_text: string }[],
): Promise<Job> {
  const r = await authFetchUrl(`${BASE}/jobs/${jobId}/revoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments }),
  })
  if (r.status === 401) throw new AuthRequiredError()
  if (!r.ok) {
    // The backend's messages here are written for the user — the source video
    // has been cleaned up, nothing was actually changed — so pass them through
    // rather than replacing them with a status code.
    const msg = await r.text().catch(() => '')
    let detail = ''
    try {
      detail = JSON.parse(msg).detail ?? ''
    } catch {
      detail = ''
    }
    throw new Error(detail || `re-dub failed: ${r.status}`)
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
