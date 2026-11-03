// The Studio Max tools and the dub report, served by the ACCOUNT API (/v1):
//
//   GET  /v1/dub-issues/:jobId            what went wrong in a dub, how to fix it
//   GET  /v1/speech-edits/:jobId          every corrected version of a dub
//   POST /v1/speech-edits                 re-dub only the changed lines
//   /v1/editor/projects/...               the video editor
//
// They live in api/ (NestJS + Prisma), not in the dubbing pipeline: the
// pipeline is the AI and is only asked, by the account API, for the jobs it
// ran and for speech. Media written by these tools is served under
// /v1/media/... — use accountMediaUrl() to load it.
import { AuthRequiredError, PaymentRequiredError } from './api'
import { apiUrl, authFetch, readError } from './http'
import type { Issue, Segment } from './types'

/** A /v1/media/... path as a URL the browser can load from any origin. */
export function accountMediaUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined
  if (/^https?:\/\//.test(path)) return path
  // apiUrl('') is the account API base, e.g. https://th-labs.uz/v1 or /v1.
  return apiUrl(path.replace(/^\/v1/, ''))
}

async function call<T>(path: string, init: RequestInit = {}, what = 'Request failed'): Promise<T> {
  const r = await authFetch(path, init)
  if (r.ok) return r.json() as Promise<T>
  if (r.status === 401) throw new AuthRequiredError()
  const message = await readError(r, what)
  if (r.status === 402) throw new PaymentRequiredError(message)
  throw new Error(message)
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// ── Dub report ──────────────────────────────────────────────────────────────

export function getDubIssues(jobId: string): Promise<Issue[]> {
  return call<{ issues: Issue[] }>(
    `/dub-issues/${encodeURIComponent(jobId)}`,
    {},
    'Could not check this dub',
  ).then((r) => r.issues)
}

// ── Speech editor ───────────────────────────────────────────────────────────

export interface LineEdit {
  id: number
  target_text?: string
  start?: number
  end?: number
}

export interface SpeechEditVersion {
  id: string
  jobId: string
  version: number
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'
  message: string | null
  error: string | null
  changed: number[]
  segments: Segment[]
  /** /v1/media/... — load with accountMediaUrl(). */
  outputUrl: string | null
  createdAt: string
  updatedAt: string
}

export function listSpeechEdits(jobId: string): Promise<SpeechEditVersion[]> {
  return call<{ versions: SpeechEditVersion[] }>(
    `/speech-edits/${encodeURIComponent(jobId)}`,
    {},
    'Could not load the edits of this dub',
  ).then((r) => r.versions)
}

export function createSpeechEdit(jobId: string, segments: LineEdit[]): Promise<SpeechEditVersion> {
  return call<SpeechEditVersion>('/speech-edits', json({ jobId, segments }), 'The edit failed')
}

// ── Video editor ────────────────────────────────────────────────────────────

export interface EditorAsset {
  id: string
  kind: 'video' | 'audio'
  name: string
  /** /v1/media/... — load with accountMediaUrl(). */
  url: string
  duration: number
  has_audio: boolean
  width: number | null
  height: number | null
  source: 'upload' | 'tts' | 'dub'
  text: string | null
  /** Loudness envelope, 20 points a second, 0..1. */
  peaks: number[]
}

export interface EditorClip {
  id: string
  asset_id: string
  /** Position on the timeline, seconds. */
  start: number
  /** The part of the asset that plays, in asset seconds. */
  trim_in: number
  trim_out: number
  volume: number
  fade_in: number
  fade_out: number
  label?: string | null
  /** Subtitle clips only: the words shown. They have no file (asset_id ''). */
  text?: string
}

/** `text` tracks hold subtitles; a video's detached sound sits on `audio`. */
export type TrackKind = 'video' | 'voice' | 'music' | 'audio' | 'text'

export interface EditorTrack {
  id: string
  kind: TrackKind
  name: string
  muted: boolean
  volume: number
  clips: EditorClip[]
}

export interface RenderState {
  status: 'idle' | 'running' | 'done' | 'failed'
  progress: number
  url: string | null
  error: string | null
  updatedAt: string | null
}

export interface EditorProject {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  assets: EditorAsset[]
  tracks: EditorTrack[]
  render: RenderState
}

export interface EditorProjectSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  duration: number
  assets: number
  clips: number
  videoUrl: string | null
  render: RenderState
}

type WithProject = { asset: EditorAsset; project: EditorProject }
const P = '/editor/projects'

export const editorApi = {
  list: () =>
    call<{ projects: EditorProjectSummary[] }>(P, {}, 'Could not load your projects').then(
      (r) => r.projects,
    ),
  create: (name: string) =>
    call<{ project: EditorProject }>(P, json({ name }), 'Could not create a project').then(
      (r) => r.project,
    ),
  get: (id: string) =>
    call<{ project: EditorProject }>(`${P}/${id}`, {}, 'Could not open this project').then(
      (r) => r.project,
    ),
  save: (id: string, body: { name?: string; tracks?: EditorTrack[] }) =>
    call<{ project: EditorProject }>(
      `${P}/${id}`,
      { ...json(body), method: 'PUT' },
      'Could not save',
    ).then((r) => r.project),
  remove: (id: string) =>
    call<{ deleted: string }>(`${P}/${id}`, { method: 'DELETE' }, 'Could not delete it'),
  upload: (id: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return call<WithProject>(`${P}/${id}/assets`, { method: 'POST', body: fd }, `Could not upload ${file.name}`)
  },
  importAsset: (
    id: string,
    body: { ttsTaskId?: string; jobId?: string; name?: string; text?: string },
  ) => call<WithProject>(`${P}/${id}/assets/import`, json(body), 'Could not import it'),
  removeAsset: (id: string, assetId: string) =>
    call<{ project: EditorProject }>(
      `${P}/${id}/assets/${assetId}`,
      { method: 'DELETE' },
      'Could not remove it',
    ).then((r) => r.project),
  /** Auto subtitles for one file: timed lines, in the FILE's seconds. */
  subtitles: (id: string, assetId: string, language = 'auto') =>
    call<{ assetId: string; language: string; lines: { start: number; end: number; text: string }[] }>(
      `${P}/${id}/assets/${assetId}/subtitles`,
      json({ language }),
      'Could not make subtitles',
    ),
  render: (id: string) =>
    call<{ project: EditorProject }>(`${P}/${id}/render`, { method: 'POST' }, 'Export failed').then(
      (r) => r.project,
    ),
}
