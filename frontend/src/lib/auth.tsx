// Auth state for the Studio. The access token lives only in memory (React
// state + the http layer) — never localStorage. Persistence across reloads is
// the httpOnly refresh cookie: on load we call /auth/refresh to mint a fresh
// access token from it. login / register / logout are backed by the account API.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import * as authApi from './auth-api'
import type { AccountUser } from './auth-api'
import {
  apiUrl,
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
// The landing site signs the user in and redirects here. What it actually
// sends is a single-use code:
//
//   /?code=<43 base64url chars>   → POST /v1/auth/handoff/exchange
//
// The code carries no identity, dies after ~60s or one redemption, and the
// exchange sets the same httpOnly refresh cookie a login would. That is the
// path that matters — see readHandoffCode below.
//
// A token may ALSO arrive in the fragment, which is supported for a caller
// that has an access token already and no way to mint a code:
//   #th_session=<base64url(JSON {accessToken, user})>        (preferred)
//   #access_token=<jwt>                                      (user from the JWT)
//
// Fragment ONLY, deliberately. Reading a token from the query string as well
// would mean a crafted link — /?access_token=<attacker's jwt> — silently signs
// a visitor into someone else's account, and unlike the fragment the query is
// sent to the server and can leak through Referer. The strip list below still
// covers the query so a stray token gets cleaned out of the URL rather than
// honoured.
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

/**
 * Take the one-time handoff code out of the query string.
 *
 * Removed from the URL as it is read, whether or not redemption later
 * succeeds: the code is single-use, so a failed attempt has burned it too and
 * leaving it visible would only invite a confusing retry.
 */
function readHandoffCode(): string | null {
  if (typeof window === 'undefined') return null
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  if (!code) return null
  url.searchParams.delete('code')
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  return code
}

/** Redeem a handoff code for an access token + the httpOnly refresh cookie. */
async function redeemHandoffCode(code: string): Promise<Session | null> {
  try {
    const r = await fetch(apiUrl('/auth/handoff/exchange'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Required: the response carries Set-Cookie for the refresh token, and
      // without this the browser discards it and every later refresh fails.
      credentials: 'include',
      body: JSON.stringify({ code }),
    })
    if (!r.ok) return null
    const data = (await r.json()) as { accessToken?: string; user?: AccountUser }
    if (!data.accessToken || !data.user) return null
    return { accessToken: data.accessToken, user: data.user }
  } catch {
    return null // network / CORS
  }
}

function readHandoff(): Session | null {
  if (typeof window === 'undefined') return null
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  // Fragment only — see the note on HANDOFF_KEYS.
  const get = (k: string) => hash.get(k)

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

  // Bootstrap: redeem a landing-page handoff code, else consume a fragment
  // token, else fall back to the refresh cookie.
  //
  // Both URL reads happen synchronously here, before any await, because they
  // mutate the address bar and the code is single-use — React StrictMode
  // double-invokes this effect in development, and a second pass must find the
  // URL already clean rather than race a redemption that is still in flight.
  useEffect(() => {
    let cancelled = false

    const code = readHandoffCode()
    const fragment = readHandoff()
    stripHandoffFromUrl()

    // Seed immediately so the first paint is signed-in when a fragment token
    // was supplied; a code still has to make a round trip.
    if (fragment) apply(fragment)

    void (async () => {
      try {
        if (code) {
          const redeemed = await redeemHandoffCode(code)
          if (cancelled) return
          if (redeemed) {
            apply(redeemed)
            return
          }
          // Expired, already spent, or unreachable — fall through; a valid
          // cookie from an earlier visit should not be discarded because this
          // particular handoff failed.
        }

        const s = await bootstrapSession()
        if (cancelled) return
        if (s) apply({ accessToken: s.accessToken, user: s.user as AccountUser })
      } finally {
        if (!cancelled) setReady(true)
      }
    })()

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
