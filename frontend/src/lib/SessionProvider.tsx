// Establishes the Studio's session once, at boot.
//
// The actual work — redeeming the handoff code, refreshing, storage — lives in
// lib/auth.ts. This is only the React surface over it: run initSession once,
// expose the result, and let the shell decide what to render. The context
// object and useSession hook live in session-context.ts.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { initSession, signOut as authSignOut, type SessionUser } from './auth'
import { SessionContext, type SessionStatus } from './session-context'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [user, setUser] = useState<SessionUser | null>(null)

  useEffect(() => {
    let cancelled = false
    // initSession consumes the ?code= query param, which is single-use — so it
    // must run exactly once. React StrictMode double-invokes effects in
    // development, and the second pass would find the code already stripped
    // from the URL and fall through to the refresh path; the `cancelled` guard
    // keeps the discarded first result from racing the second.
    initSession()
      .then((u) => {
        if (cancelled) return
        setUser(u)
        setStatus(u ? 'authenticated' : 'anonymous')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('anonymous')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const signOut = useCallback(async () => {
    await authSignOut()
    setUser(null)
    setStatus('anonymous')
  }, [])

  const invalidate = useCallback(() => {
    setUser(null)
    setStatus('anonymous')
  }, [])

  return (
    <SessionContext.Provider value={{ status, user, signOut, invalidate }}>
      {children}
    </SessionContext.Provider>
  )
}
