// Session handling for the Studio.
//
// The Studio has no sign-in form. Accounts live on the landing page
// (th-labs.uz), which authenticates the user and then redirects here with a
// single-use handoff code:
//
//     https://<studio>/?code=<43 base64url chars>
//
// Boot sequence:
//   1. If ?code= is present, POST it to the account API's exchange endpoint.
//      It is valid for ~60s and exactly one redemption.
//   2. Strip ?code= from the address bar immediately, before React paints, so
//      the spent code does not linger in history or get copy-pasted around.
//   3. Keep the access token in memory only. Persist the refresh token so a
//      page reload does not bounce the user back to the landing page.
//
// On the refresh token in localStorage: it is readable by any script running
// on this origin, which is the standing weakness of a browser-held session on
// a third-party origin. It is a deliberate trade, not an oversight — the
// alternative is losing the session on every reload. The exposure is bounded
// by the Studio shipping no third-party scripts (check index.html before
// adding one) and by refresh tokens being revocable server-side via logout,
// which clears hashedRefreshToken. Serving the Studio from the landing page's
// own origin would remove the trade entirely by allowing an HttpOnly cookie;
// that is the real fix if the two ever converge.

export interface SessionUser {
  id: number
  email: string
  name?: string
  role: string
}

// The NestJS account API. Same host that serves the landing page, /v1 handled
// by Caddy. Override at build time when running against a local API.
const ACCOUNT_API =
  import.meta.env.VITE_ACCOUNT_API_URL?.replace(/\/$/, '') ||
  'https://th-labs.uz/v1'

// Where to send someone who has no session. The landing page owns sign-in.
export const LANDING_URL =
  import.meta.env.VITE_LANDING_URL?.replace(/\/$/, '') || 'https://th-labs.uz'

const REFRESH_KEY = 'th-labs.refresh'

// In memory on purpose — never written to storage. Short-lived (15m) and
// re-derivable from the refresh token, so persisting it would add exposure
// without buying anything.
let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

function readRefreshToken(): string | null {
  try {
    return window.localStorage.getItem(REFRESH_KEY)
  } catch {
    return null // private mode / storage disabled
  }
}

function writeRefreshToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(REFRESH_KEY, token)
    else window.localStorage.removeItem(REFRESH_KEY)
  } catch {
    /* storage disabled — session simply won't survive a reload */
  }
}

interface TokenPair {
  accessToken: string
  refreshToken: string
  user: SessionUser
}

function storeTokens(pair: TokenPair): SessionUser {
  accessToken = pair.accessToken
  writeRefreshToken(pair.refreshToken)
  return pair.user
}

export function clearSession(): void {
  accessToken = null
  writeRefreshToken(null)
  // Drop the memoised boot too, or a later initSession() would hand back the
  // user we just signed out.
  sessionInit = null
}

/**
 * Pull ?code= out of the URL and remove it from the address bar.
 *
 * The strip happens whether or not the redemption later succeeds — a code is
 * single-use, so a failed attempt has burned it too and leaving it in the URL
 * would only invite a confusing retry.
 */
function takeHandoffCode(): string | null {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  if (!code) return null

  params.delete('code')
  const query = params.toString()
  window.history.replaceState(
    {},
    '',
    window.location.pathname + (query ? `?${query}` : '') + window.location.hash,
  )
  return code
}

async function exchangeCode(code: string): Promise<SessionUser | null> {
  try {
    const r = await fetch(`${ACCOUNT_API}/auth/handoff/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    if (!r.ok) return null
    return storeTokens((await r.json()) as TokenPair)
  } catch {
    return null // network / CORS
  }
}

/** Trade the stored refresh token for a fresh pair. */
async function refreshSession(): Promise<SessionUser | null> {
  const refreshToken = readRefreshToken()
  if (!refreshToken) return null

  try {
    const r = await fetch(`${ACCOUNT_API}/auth/refresh`, {
      method: 'POST',
      // The refresh endpoint reads the REFRESH token as the bearer credential
      // (jwt-refresh.strategy.ts), which is why this is not the access token.
      headers: { Authorization: `Bearer ${refreshToken}` },
    })
    if (!r.ok) {
      // Expired or revoked (a logout elsewhere nulls hashedRefreshToken).
      // Drop it so we stop retrying with a token that can never work.
      clearSession()
      return null
    }
    return storeTokens((await r.json()) as TokenPair)
  } catch {
    return null // network blip — keep the token and let the next call retry
  }
}

async function establishSession(): Promise<SessionUser | null> {
  const code = takeHandoffCode()
  if (code) {
    const user = await exchangeCode(code)
    if (user) return user
    // Code was expired, already spent, or the API was unreachable. Fall
    // through — a still-valid refresh token from an earlier visit should not
    // be discarded just because this particular handoff failed.
  }
  return refreshSession()
}

// The in-flight (or settled) boot. See initSession.
let sessionInit: Promise<SessionUser | null> | null = null

/**
 * Establish a session at boot: redeem an incoming code, else resume from the
 * stored refresh token. Returns null when the visitor is signed out.
 *
 * Memoised, and that is load-bearing rather than an optimisation. Boot is not
 * idempotent — takeHandoffCode() removes ?code= from the URL, and the code is
 * single-use — so a second concurrent call sees a URL with no code and falls
 * through to the refresh path, where localStorage is still empty because the
 * first call's exchange has not resolved yet. It then resolves null, and a
 * caller that trusts the later answer renders a signed-out Studio for a user
 * who just signed in successfully.
 *
 * React StrictMode makes that the norm, not a rare race: it deliberately
 * double-invokes effects in development. Handing every caller the SAME promise
 * means the redemption happens once and everyone sees its result.
 */
export function initSession(): Promise<SessionUser | null> {
  if (!sessionInit) sessionInit = establishSession()
  return sessionInit
}

export async function signOut(): Promise<void> {
  const token = accessToken
  clearSession()
  if (!token) return
  try {
    // Best effort: revokes hashedRefreshToken server-side so the refresh token
    // we just dropped cannot be replayed if a copy leaked. A failure here
    // still leaves the browser signed out.
    await fetch(`${ACCOUNT_API}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    /* ignore */
  }
}

/**
 * Read `exp` out of a JWT without verifying it.
 *
 * Purely a scheduling hint for the proactive refresh below — the server still
 * verifies every token properly, so a forged `exp` here buys nothing beyond a
 * wasted refresh. Returns null for anything unparseable, which callers treat
 * as "assume expired".
 */
function tokenExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    // base64url → base64 before atob, which does not accept - or _.
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const exp = JSON.parse(json).exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

// Refresh this far ahead of expiry rather than waiting for a 401. Covers clock
// skew between the browser and the API plus the round-trip itself.
const REFRESH_MARGIN_MS = 60_000

/**
 * Refresh the access token if it is expired or about to be.
 *
 * This matters more than the 401-retry below, because of what the Studio
 * sends: access tokens last 15 minutes, and a user who lands here spends that
 * easily on picking languages and choosing a file before pressing Start. If
 * the first sign that the token died is a 401 on POST /api/jobs, the browser
 * has already uploaded the entire video — and the retry uploads it a second
 * time. Checking `exp` first means the token is renewed with a tiny request
 * before the big one starts.
 */
async function ensureFreshToken(): Promise<void> {
  if (!accessToken) {
    await refreshSession()
    return
  }
  const expiry = tokenExpiry(accessToken)
  if (expiry === null || expiry - Date.now() <= REFRESH_MARGIN_MS) {
    await refreshSession()
  }
}

/**
 * fetch() with the access token attached.
 *
 * Refreshes ahead of expiry, and still retries once on a 401 — the proactive
 * check cannot catch a token revoked server-side (a logout elsewhere) or a
 * large clock skew.
 */
export async function authFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const call = (token: string | null) =>
    fetch(input, {
      ...init,
      headers: {
        ...init.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })

  await ensureFreshToken()

  let res = await call(accessToken)
  if (res.status !== 401) return res

  const user = await refreshSession()
  if (!user) return res // still signed out — hand back the original 401
  res = await call(accessToken)
  return res
}

/**
 * Append the access token to an EventSource URL.
 *
 * EventSource takes a URL and nothing else — it cannot send an Authorization
 * header — so the SSE route accepts ?access_token= as well (see
 * backend/app/auth.py). Only the short-lived access token goes here, never the
 * refresh token, and the request is same-origin.
 *
 * Safe to read the token synchronously: every caller subscribes immediately
 * after createJob(), which has just refreshed it through authFetch.
 */
export function withAccessToken(url: string): string {
  if (!accessToken) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}access_token=${encodeURIComponent(accessToken)}`
}
