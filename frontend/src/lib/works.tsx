// The user's library of real dubs.
//
// Every record here is written by the Studio from an actual pipeline job — its
// media URLs, transcript segments, settings and credit cost all come off the
// job the backend returned. There is no seeded or sample content: a new account
// sees an empty library until it runs a dub.
//
// The library belongs to the ACCOUNT, not the browser. The account API keeps it
// (GET/PUT/DELETE /v1/works) and this provider syncs with it, so a dub run in
// Chrome is in My Works when the same account signs in on Safari or a phone.
// It used to live only in localStorage, which is exactly why it didn't.
//
// localStorage is still used, per account, as a cache: it paints the page
// instantly and holds anything not yet saved (offline, API asleep) until the
// next sync pushes it up.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from './auth'
import { authFetch, authJson } from './http'
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
  /**
   * True when the balance covered only part of the source and the dub was cut
   * to fit. Worth keeping in the library: months later, "why is this clip only a
   * minute long?" has an answer, and the row can offer to redo it in full.
   */
  trimmed?: boolean
  /** Full length of the source before the trim, when one happened. */
  sourceSec?: number | null
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
  /**
   * A small JPEG data URL of a frame from the dub, captured once by WorkThumb
   * and saved with the record — so every device shows a picture immediately
   * instead of decoding the video again.
   */
  thumbnail?: string | null
  /** Last local change, ms. Decides which copy wins when two devices disagree. */
  updatedAt?: number
  /** True once the account API has this record. Local bookkeeping only. */
  synced?: boolean
}

interface WorksContextValue {
  works: Work[]
  addWork: (w: Work) => void
  updateWork: (id: string, patch: Partial<Work>) => void
  removeWork: (id: string) => void
  clear: () => void
}

// Before the library was per account there was one shared key. Whatever is in
// it was run in this browser, so it is adopted by the first account to sign in
// here and uploaded — that is how existing users' history reaches their other
// devices.
const LEGACY_KEY = 'th-labs.works'
const keyFor = (userId: number) => `th-labs.works.${userId}`
// Coalesces the progress updates a running dub sends several times a second.
const SAVE_DEBOUNCE_MS = 1500
// Re-read the account's library when the tab comes back, at most this often,
// so a dub finished on another device appears without a reload.
const REFRESH_MIN_MS = 20_000
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
    trimmed: r.trimmed === true,
    sourceSec: (r.sourceSec as number | null) ?? null,
    thumbnail: typeof r.thumbnail === 'string' ? r.thumbnail : null,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
    synced: r.synced === true,
  }
}

function parseList(raw: unknown): Work[] {
  if (!Array.isArray(raw)) return []
  return raw.map(migrate).filter((w): w is Work => w !== null)
}

function readKey(key: string): Work[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? parseList(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

function loadCache(userId: number): Work[] {
  const own = readKey(keyFor(userId))
  const legacy = readKey(LEGACY_KEY)
  if (!legacy.length) return own
  try {
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    /* unavailable storage */
  }
  const ids = new Set(own.map((w) => w.id))
  // Never `synced`: the server has not seen these, so the next sync uploads them.
  return byNewest([...own, ...legacy.filter((w) => !ids.has(w.id)).map((w) => ({ ...w, synced: false }))])
}

function byNewest(list: Work[]): Work[] {
  return [...list].sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Reconcile this browser's copy with the account's.
 *
 * Both sides have it → the more recently changed one wins. Only the server has
 * it → it was made on another device. Only this browser has it → either it was
 * never uploaded (keep it, push it) or it was uploaded and since deleted
 * elsewhere (drop it). `fetchedAt` guards the last case against a record saved
 * while the list request was in flight, which the list cannot contain yet.
 */
function merge(local: Work[], server: Work[], fetchedAt: number): { works: Work[]; push: Work[] } {
  const out = new Map<string, Work>()
  for (const w of server) out.set(w.id, { ...w, synced: true })
  const push: Work[] = []
  for (const w of local) {
    const remote = out.get(w.id)
    if (remote) {
      if ((w.updatedAt ?? 0) > (remote.updatedAt ?? 0)) {
        out.set(w.id, w)
        push.push(w)
      }
    } else if (!w.synced || (w.updatedAt ?? 0) >= fetchedAt) {
      out.set(w.id, w)
      push.push(w)
    }
  }
  return { works: byNewest([...out.values()]), push }
}

export function WorksProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [works, setWorks] = useState<Work[]>([])
  // Which account `works` belongs to. Saving is skipped until it matches, so a
  // sign-out/sign-in never writes one account's list under the other's key.
  const [owner, setOwner] = useState<number | null>(null)

  const worksRef = useRef(works)
  worksRef.current = works
  // Records changed locally and not yet sent, and their pending timers.
  const dirty = useRef(new Set<string>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const lastFetch = useRef(0)

  const push = useCallback((w: Work) => {
    const { synced: _synced, ...work } = w
    void authFetch(`/works/${encodeURIComponent(w.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ work }),
    })
      .then((r) => {
        if (!r.ok) return
        setWorks((prev) => prev.map((x) => (x.id === w.id && !x.synced ? { ...x, synced: true } : x)))
      })
      .catch(() => {
        /* stays unsynced; the next refresh pushes it again */
      })
  }, [])

  const refresh = useCallback(async () => {
    const startedAt = Date.now()
    lastFetch.current = startedAt
    try {
      const server = parseList(await authJson<unknown[]>('/works', {}, 'Could not load your library'))
      const result = merge(worksRef.current, server, startedAt)
      setWorks(result.works)
      result.push.forEach(push)
    } catch {
      /* offline or API asleep — the cached copy stays on screen */
    }
  }, [push])

  // Account changed: show its cached copy at once, then sync with the server.
  useEffect(() => {
    timers.current.forEach(clearTimeout)
    timers.current.clear()
    dirty.current.clear()
    if (userId == null) {
      setWorks([])
      setOwner(null)
      return
    }
    const cached = loadCache(userId)
    worksRef.current = cached
    setWorks(cached)
    setOwner(userId)
    void refresh()
  }, [userId, refresh])

  // A dub finished on the phone should be here when you switch back to this tab.
  useEffect(() => {
    if (userId == null) return
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetch.current > REFRESH_MIN_MS) {
        void refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [userId, refresh])

  // Persist the cache, and send whatever changed.
  useEffect(() => {
    if (owner == null || owner !== userId) return
    try {
      localStorage.setItem(keyFor(owner), JSON.stringify(works))
    } catch {
      /* ignore quota / unavailable storage */
    }
    for (const id of dirty.current) {
      const w = works.find((x) => x.id === id)
      if (!w) continue
      const t = timers.current.get(id)
      if (t) clearTimeout(t)
      // A running dub reports progress constantly — batch those. Anything
      // else (it finished, it failed, it got a thumbnail) goes now.
      const delay = w.status === 'processing' ? SAVE_DEBOUNCE_MS : 0
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id)
          const latest = worksRef.current.find((x) => x.id === id)
          if (latest) push(latest)
        }, delay),
      )
    }
    dirty.current.clear()
  }, [works, owner, userId, push])

  const addWork = useCallback((w: Work) => {
    dirty.current.add(w.id)
    // Newest first; de-dupe by job id so re-renders don't double-insert.
    setWorks((prev) => [{ ...w, updatedAt: Date.now(), synced: false }, ...prev.filter((x) => x.id !== w.id)])
  }, [])

  // Used when a fact arrives after the record is written — the credit charge
  // resolves a moment after the job completes.
  const updateWork = useCallback((id: string, patch: Partial<Work>) => {
    dirty.current.add(id)
    setWorks((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch, updatedAt: Date.now() } : w)))
  }, [])

  const removeWork = useCallback((id: string) => {
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.delete(id)
    dirty.current.delete(id)
    setWorks((prev) => prev.filter((x) => x.id !== id))
    void authFetch(`/works/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
  }, [])

  const clear = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current.clear()
    dirty.current.clear()
    setWorks([])
    void authFetch('/works', { method: 'DELETE' }).catch(() => {})
  }, [])

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
