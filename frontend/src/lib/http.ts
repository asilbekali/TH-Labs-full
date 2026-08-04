// Shared authenticated fetch for the account/billing API (NestJS, /v1).
//
// The access token lives only in memory here (never localStorage) — the auth
// context feeds it in on login and clears it on logout. The refresh token is an
// httpOnly cookie the browser sends automatically on /v1/auth/refresh, so every
// request opts into credentials: 'include'. On a 401 we attempt exactly one
// silent refresh, then retry the original request once; if that fails we clear
// auth state and let the app fall back to signed-out.
//
// In dev the base defaults to the Vite proxy ('/v1' → :3001). VITE_ACCOUNT_API
// overrides it (e.g. http://localhost:3001/v1) — .env.local wins over .env, so
// the local override reliably beats the production default baked into auth-api.
const BASE: string = import.meta.env.VITE_ACCOUNT_API ?? '/v1'

// The relative fallback is correct ONLY in dev, where vite.config.ts proxies
// /v1 to the NestJS API on :3001. In production the Studio is served from its
// own origin (*.modal.run) where /v1 is not the account API at all — it falls
// through to the SPA catch-all, which answers a POST with 405. Nothing throws,
// so sign-in simply never completes and the form looks like it ignored you.
//
// That is exactly what a VITE_ACCOUNT_API/VITE_ACCOUNT_API_URL name mismatch
// in deploy/modal/modal_app.py caused. Say so loudly rather than let the next
// one be diagnosed from a screenshot.
if (
  BASE.startsWith('/') &&
  typeof window !== 'undefined' &&
  !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)
) {
  console.error(
    `[auth] VITE_ACCOUNT_API is unset, so the account API resolves to ` +
      `"${window.location.origin}${BASE}" — this origin, not the account API. ` +
      `Sign-in and every /v1 call will fail. Set VITE_ACCOUNT_API at BUILD time ` +
      `(Vite inlines it) to e.g. https://th-labs.uz/v1`,
  )
}

let accessToken: string | null = null

// Callbacks the auth context registers so the http layer can push a silently
// refreshed session back into React state, or signal that auth was lost.
export interface RefreshedSession {
  accessToken: string
  user: unknown
}
let onRefreshed: ((s: RefreshedSession) => void) | null = null
let onCleared: (() => void) | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

export function registerAuthHandlers(handlers: {
  onRefreshed?: (s: RefreshedSession) => void
  onCleared?: () => void
}): void {
  onRefreshed = handlers.onRefreshed ?? null
  onCleared = handlers.onCleared ?? null
}

export function apiUrl(path: string): string {
  return `${BASE}${path}`
}

// A single in-flight refresh shared across concurrent 401s, so a burst of
// requests triggers one refresh, not one each.
let refreshInFlight: Promise<string | null> | null = null

async function refreshOnce(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const r = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        })
        if (!r.ok) return null
        const data = (await r.json()) as RefreshedSession
        accessToken = data.accessToken
        onRefreshed?.(data)
        return data.accessToken
      } catch {
        return null
      } finally {
        refreshInFlight = null
      }
    })()
  }
  return refreshInFlight
}

// Bootstrap the session on app load: try to mint an access token from the
// refresh cookie. Returns the refreshed session or null when signed out.
export async function bootstrapSession(): Promise<RefreshedSession | null> {
  try {
    const r = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!r.ok) return null
    const data = (await r.json()) as RefreshedSession
    accessToken = data.accessToken
    return data
  } catch {
    return null
  }
}

async function readError(r: Response, fallback: string): Promise<string> {
  try {
    const body = await r.json()
    const m = body?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  } catch {
    /* non-JSON body */
  }
  return fallback
}

// Authenticated fetch against an already-complete URL, with one silent-refresh
// retry on 401.
//
// Exists separately from authFetch because there are TWO backends: the account
// API at BASE (/v1, NestJS) and the dubbing API the Studio is served from
// (/api, FastAPI). Both verify the same bearer token — backend/app/auth.py
// checks it against the shared JWT_SECRET — but only the first lives under
// BASE, so routing /api/jobs through authFetch would request /v1/api/jobs.
export async function authFetchUrl(
  url: string,
  init: RequestInit = {},
  _retry = true,
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)

  const res = await fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (res.status === 401 && _retry) {
    const token = await refreshOnce()
    if (!token) {
      onCleared?.()
      return res
    }
    return authFetchUrl(url, init, false)
  }
  return res
}

// Authenticated fetch against the account API (paths are relative to BASE).
export function authFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return authFetchUrl(`${BASE}${path}`, init)
}

// authFetch + JSON parsing + NestJS-style error extraction.
export async function authJson<T>(
  path: string,
  init: RequestInit = {},
  fallbackError = 'Request failed',
): Promise<T> {
  const res = await authFetch(path, init)
  if (!res.ok) throw new Error(await readError(res, fallbackError))
  return res.json() as Promise<T>
}

export { readError }
