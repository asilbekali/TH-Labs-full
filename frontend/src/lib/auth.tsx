// Auth state for the Studio. The access token lives only in memory (React
// state + the http layer) — never localStorage. Persistence across reloads is
// the httpOnly refresh cookie: on load we call /auth/refresh to mint a fresh
// access token from it. login / register / logout are backed by the account API.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import * as authApi from './auth-api'
import type { AccountUser } from './auth-api'
import {
  bootstrapSession,
  registerAuthHandlers,
  setAccessToken,
  type RefreshedSession,
} from './http'

interface Session {
  accessToken: string
  user: AccountUser
}

interface AuthContextValue {
  user: AccountUser | null
  accessToken: string | null
  ready: boolean // false until the initial cookie-refresh bootstrap resolves
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  updateUser: (partial: Partial<AccountUser>) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

// ── Session handoff from the landing page ──────────────────────────────────
// The marketing/landing site may sign the user in and redirect here, handing an
// access token over in the URL fragment (never the query string, so tokens are
// not sent to servers or leaked via Referer). We consume it once to seed the
// in-memory token, then strip it from the URL. Refresh still relies on the
// httpOnly cookie the shared API set at login — the fragment's refresh token
// (if any) is ignored under the cookie model.
//   #th_session=<base64url(JSON {accessToken, user})>        (preferred)
//   #access_token=<jwt>                                      (user from the JWT)
const HANDOFF_KEYS = ['th_session', 'access_token', 'refresh_token']

function b64urlDecode(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function parseJwt(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(b64urlDecode(token.split('.')[1]))
  } catch {
    return null
  }
}

function readHandoff(): Session | null {
  if (typeof window === 'undefined') return null
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search)
  const get = (k: string) => hash.get(k) ?? query.get(k)

  try {
    const session = get('th_session')
    if (session) {
      const parsed = JSON.parse(b64urlDecode(session)) as Session
      if (parsed?.accessToken && parsed?.user) return parsed
    }

    const accessToken = get('access_token')
    if (accessToken) {
      const claims = parseJwt(accessToken)
      const email = (claims?.email as string) ?? ''
      return {
        accessToken,
        user: {
          id: Number(claims?.sub) || 0,
          email,
          name: email,
          role: (claims?.role as AccountUser['role']) ?? 'USER',
          createdAt: '',
        },
      }
    }
  } catch {
    /* malformed handoff — fall through to the cookie bootstrap */
  }
  return null
}

function stripHandoffFromUrl(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
  let changed = false
  for (const k of HANDOFF_KEYS) {
    if (url.searchParams.has(k)) {
      url.searchParams.delete(k)
      changed = true
    }
    if (hash.has(k)) {
      hash.delete(k)
      changed = true
    }
  }
  if (!changed) return
  const rest = hash.toString()
  url.hash = rest ? `#${rest}` : ''
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  const apply = useCallback((s: Session | null) => {
    setAccessToken(s?.accessToken ?? null)
    setSession(s)
  }, [])

  // Let the http layer push a silently-refreshed session into state, and clear
  // state when a refresh ultimately fails (signed out).
  useEffect(() => {
    registerAuthHandlers({
      onRefreshed: (s: RefreshedSession) =>
        setSession((prev) =>
          prev
            ? { accessToken: s.accessToken, user: (s.user as AccountUser) ?? prev.user }
            : { accessToken: s.accessToken, user: s.user as AccountUser },
        ),
      onCleared: () => {
        setAccessToken(null)
        setSession(null)
      },
    })
  }, [])

  // Bootstrap: consume any landing-page handoff, then try the refresh cookie.
  useEffect(() => {
    let cancelled = false
    const handoff = readHandoff()
    stripHandoffFromUrl()
    if (handoff) apply(handoff)

    bootstrapSession()
      .then((s) => {
        if (cancelled) return
        if (s) apply({ accessToken: s.accessToken, user: s.user as AccountUser })
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await authApi.login(email, password)
      apply({ accessToken: res.accessToken, user: res.user })
    },
    [apply],
  )

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const res = await authApi.register(name, email, password)
      apply({ accessToken: res.accessToken, user: res.user })
    },
    [apply],
  )

  const logout = useCallback(async () => {
    await authApi.logout()
    apply(null)
  }, [apply])

  const updateUser = useCallback((partial: Partial<AccountUser>) => {
    setSession((s) => (s ? { ...s, user: { ...s.user, ...partial } } : s))
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      accessToken: session?.accessToken ?? null,
      ready,
      login,
      register,
      logout,
      updateUser,
    }),
    [session, ready, login, register, logout, updateUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
