// The user's library of real dubs.
//
// Every record here is written by the Studio from an actual pipeline job — its
// media URLs, transcript segments, settings and credit cost all come off the
// job the backend returned. There is no seeded or sample content: a new account
// sees an empty library until it runs a dub.
//
// Storage is localStorage, per device. The dubbing API exposes GET /jobs/{id}
// but has no "list my jobs" route, so the client keeps the index. That is the
// one real limitation of this page — see `worksStorageNote` below, which the UI
// shows rather than pretending the list is account-wide.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Segment } from './types'

export type WorkStatus = 'completed' | 'processing' | 'failed'

export interface Work {
  id: string
  createdAt: number
  status: WorkStatus
  /** Original upload name; null for a run against the built-in sample clip. */
  filename: string | null
  sourceLang: string
  targetLang: string
  /** Real output length in seconds, as measured by the pipeline. */
  durationSec: number | null
  outputUrl: string | null
  sourceUrl: string | null
  /** True when the backend ran in simulation mode (no GPU models loaded). */
  simulated: boolean
  speakerSimilarity: number | null
  /** Credits actually charged by POST /v1/payments/commit-dub. */
  creditsSpent: number | null
  settings: {
    voiceClone: boolean
    lipSync: boolean
    keepBackground: boolean
    quality: string
  }
  /** The real ASR/NMT transcript. Empty when the job produced no segments. */
  segments: Segment[]
  /** Failure text straight from the pipeline; only set when status is failed. */
  error: string | null
  /** Live pipeline position, mirrored from SSE while status is processing. */
  progress: number | null
  stage: string | null
}

export const worksStorageNote =
  'Your library is stored on this device — the dubbing API has no list-jobs route yet, so dubs run elsewhere will not appear here.'

interface WorksContextValue {
  works: Work[]
  addWork: (w: Work) => void
  updateWork: (id: string, patch: Partial<Work>) => void
  removeWork: (id: string) => void
  clear: () => void
}

const STORAGE_KEY = 'th-labs.works'
const WorksContext = createContext<WorksContextValue | null>(null)

// Records written before the schema grew status/settings/segments are missing
// those fields. Rather than drop a user's real history on upgrade, fill the
// gaps: anything already saved had completed, and a v1 record only ever stored
// its quality.
function migrate(raw: unknown): Work | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  const legacySettings = (r.settings ?? {}) as Record<string, unknown>
  return {
    id: r.id,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    status: (r.status as WorkStatus) ?? 'completed',
    filename: (r.filename as string | null) ?? null,
    sourceLang: (r.sourceLang as string) ?? 'auto',
    targetLang: (r.targetLang as string) ?? '',
    durationSec: (r.durationSec as number | null) ?? null,
    outputUrl: (r.outputUrl as string | null) ?? null,
    sourceUrl: (r.sourceUrl as string | null) ?? null,
    simulated: r.simulated === true,
    speakerSimilarity: (r.speakerSimilarity as number | null) ?? null,
    creditsSpent: (r.creditsSpent as number | null) ?? null,
    settings: {
      voiceClone: legacySettings.voiceClone !== false,
      lipSync: legacySettings.lipSync === true,
      keepBackground: legacySettings.keepBackground !== false,
      quality: (legacySettings.quality as string) ?? (r.quality as string) ?? 'balanced',
    },
    segments: Array.isArray(r.segments) ? (r.segments as Segment[]) : [],
    error: (r.error as string | null) ?? null,
    progress: (r.progress as number | null) ?? null,
    stage: (r.stage as string | null) ?? null,
  }
}

function load(): Work[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(migrate).filter((w): w is Work => w !== null)
  } catch {
    return []
  }
}

export function WorksProvider({ children }: { children: ReactNode }) {
  const [works, setWorks] = useState<Work[]>(() => load())

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(works))
    } catch {
      /* ignore quota / unavailable storage */
    }
  }, [works])

  const addWork = useCallback((w: Work) => {
    // Newest first; de-dupe by job id so re-renders don't double-insert.
    setWorks((prev) => [w, ...prev.filter((x) => x.id !== w.id)])
  }, [])

  // Used when a fact arrives after the record is written — the credit charge
  // resolves a moment after the job completes.
  const updateWork = useCallback((id: string, patch: Partial<Work>) => {
    setWorks((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)))
  }, [])

  const removeWork = useCallback((id: string) => {
    setWorks((prev) => prev.filter((x) => x.id !== id))
  }, [])

  const clear = useCallback(() => setWorks([]), [])

  const value = useMemo<WorksContextValue>(
    () => ({ works, addWork, updateWork, removeWork, clear }),
    [works, addWork, updateWork, removeWork, clear],
  )

  return <WorksContext.Provider value={value}>{children}</WorksContext.Provider>
}

export function useWorks(): WorksContextValue {
  const ctx = useContext(WorksContext)
  if (!ctx) throw new Error('useWorks must be used within a WorksProvider')
  return ctx
}

/* ── Derived display helpers ─────────────────────────────────────────────── */

/** A dub has no title of its own — use the source file, or say it was the sample. */
export function workTitle(w: Work): string {
  if (!w.filename) return 'Sample clip'
  return w.filename.replace(/\.[a-z0-9]{2,4}$/i, '')
}

export function workPair(w: Work): string {
  return `${w.sourceLang.toUpperCase()}→${w.targetLang.toUpperCase()}`
}
