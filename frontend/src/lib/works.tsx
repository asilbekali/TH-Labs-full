// A client-side library of the user's finished dubs, persisted to
// localStorage. The Studio appends a record when a job completes; the "My Works"
// page reads and manages them. There's no dedicated backend for this yet, so
// like the wallet it lives on the device.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export interface Work {
  id: string
  createdAt: number
  filename: string | null
  sourceLang: string
  targetLang: string
  quality: string
  simulated: boolean
  outputUrl: string | null
  sourceUrl: string | null
  durationSec: number | null
  speakerSimilarity: number | null
}

interface WorksContextValue {
  works: Work[]
  addWork: (w: Work) => void
  removeWork: (id: string) => void
  clear: () => void
}

const STORAGE_KEY = 'th-labs.works'
const WorksContext = createContext<WorksContextValue | null>(null)

function load(): Work[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as Work[]
    }
  } catch {
    /* ignore */
  }
  return []
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

  const removeWork = useCallback((id: string) => {
    setWorks((prev) => prev.filter((x) => x.id !== id))
  }, [])

  const clear = useCallback(() => setWorks([]), [])

  const value = useMemo<WorksContextValue>(
    () => ({ works, addWork, removeWork, clear }),
    [works, addWork, removeWork, clear],
  )

  return <WorksContext.Provider value={value}>{children}</WorksContext.Provider>
}

export function useWorks(): WorksContextValue {
  const ctx = useContext(WorksContext)
  if (!ctx) throw new Error('useWorks must be used within a WorksProvider')
  return ctx
}
