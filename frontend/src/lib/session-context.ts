// The session context object and its hook.
//
// Split out from SessionProvider.tsx so that file exports only a component —
// React Fast Refresh can only preserve state across edits when a module's
// exports are all components, and mixing a hook in there silently downgrades
// HMR to a full reload for every consumer.

import { createContext, useContext } from 'react'
import type { SessionUser } from './auth'

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous'

export interface SessionValue {
  status: SessionStatus
  user: SessionUser | null
  signOut: () => Promise<void>
  /** Called when a request 401s past the point authFetch can recover it. */
  invalidate: () => void
}

export const SessionContext = createContext<SessionValue | null>(null)

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}
