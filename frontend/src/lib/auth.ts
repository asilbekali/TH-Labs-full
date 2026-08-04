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
//      Valid ~60s and exactly one redemption.
//   2. Strip ?code= from the address bar immediately, so a spent code does not
//      linger in history or get copy-pasted around.
//   3. Otherwise try to resume: POST /auth/refresh and let the cookie speak.
//
// ── Where the refresh token lives ──────────────────────────────────────────
// Nowhere this code can see it. The account API sets it as an httpOnly,
// Secure, SameSite=None cookie scoped to /v1/auth on th-labs.uz, so it is
// unreadable from JavaScript and immune to XSS on this origin. Every call that
// needs it therefore uses credentials:'include' and sends NO Authorization
// header — the browser attaches the cookie itself.
//
// This replaces an earlier version that kept the refresh token in
// localStorage. That was a deliberate trade at the time (a JWT refresh token
// had to live somewhere for a reload to survive); the cookie redesign in the
// account API removed the need for it entirely.
//
// The cost is that from this origin the cookie is third-party. Safari blocks
// those outright and Chrome is winding them down, so refresh can fail for
// reasons that have nothing to do with the session being invalid. That is what
// the silent resume below is for.

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

// Set before bouncing to the landing page for a silent re-handoff, so a failure
// over there cannot ping-pong the user back and forth. sessionStorage rather
// than localStorage: the guard should last exactly one browsing session.
const RESUME_FLAG = 'th-labs.resume-attempted'

// In memory only — never persisted. Short-lived (15m) and re-derivable from the
// cookie, so writing it anywhere would add exposure and buy nothing.
let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

/** Shape of a successful login / refresh / exchange under the cookie design. */
interface AuthPayload {
  accessToken: string
  user: SessionUser
}

function store(payload: AuthPayload): SessionUser {
  accessToken = payload.accessToken
  try {
    // A working session means the resume path is not stuck; let a future
    // failure try it again.
    window.sessionStorage.removeItem(RESUME_FLAG)
  } catch {
    /* storage disabled */
  }
  return payload.user
}

export function clearSession(): void {
  accessToken = null
  sessionInit = null
}

/**
 * Pull ?code= out of the URL and remove it from the address bar.
 *
 * The strip happens whether or not redemption later succeeds — a code is
 * single-use, so a failed attempt has burned it too, and leaving it in the URL
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
      // Required: the response carries Set-Cookie for the refresh token, and
      // without this the browser discards it and every later refresh fails.
      credentials: 'include',
      body: JSON.stringify({ code }),
    })
    if (!r.ok) return null
    return store((await r.json()) as AuthPayload)
  } catch {
    return null // network / CORS
  }
}

/** Mint a new access token from the httpOnly refresh cookie. */
async function refreshSession(): Promise<SessionUser | null> {
  try {
    const r = await fetch(`${ACCOUNT_API}/auth/refresh`, {
      method: 'POST',
      // No Authorization header on purpose — the refresh token is the cookie,
      // and this is the only thing that sends it.
      credentials: 'include',
    })
    if (!r.ok) return null
    return store((await r.json()) as AuthPayload)
  } catch {
    return null
  }
}

/**
 * Bounce to the landing page so it can mint a fresh code and send us back.
 *
 * Reached when refresh fails, which on this origin usually means the browser
 * refused to send a third-party cookie rather than that the user is signed
 * out. The landing page is first-party to that same cookie, so it can still
 * see the session and redirect straight back with a new code — no sign-in
 * prompt, no typing.
 *
 * Guarded by a one-shot flag: if the landing page cannot resume either, it
 * shows its sign-in form, and coming back here without a session must not
 * bounce the user out again.
 *
 * Returns true if a navigation was started, in which case the caller should
 * stop — the page is going away.
 */
function attemptSilentResume(): boolean {
  let alreadyTried = false
  try {
    alreadyTried = window.sessionStorage.getItem(RESUME_FLAG) === '1'
    if (!alreadyTried) window.sessionStorage.setItem(RESUME_FLAG, '1')
  } catch {
    // Storage disabled — no way to guard against a loop, so do not start one.
    return false
  }
  if (alreadyTried) return false

  // `studio=1` asks the landing page to resume rather than render marketing.
  window.location.replace(`${LANDING_URL}/?studio=1`)
  return true
}

async function establishSession(): Promise<SessionUser | null> {
  const code = takeHandoffCode()
  if (code) {
    const user = await exchangeCode(code)
    if (user) return user
    // Expired, already spent, or the API was unreachable. Fall through — a
    // still-valid cookie from an earlier visit should not be discarded just
    // because this particular handoff failed.
  }

  const resumed = await refreshSession()
  if (resumed) return resumed

  // No session here. Before showing the gate, give the landing page a chance
  // to hand us one back silently. If it navigates, this promise never settles
  // in any way that matters — the page is unloading.
  if (!code && attemptSilentResume()) return null

  return null
}

// The in-flight (or settled) boot. See initSession.
let sessionInit: Promise<SessionUser | null> | null = null

/**
 * Establish a session at boot: redeem an incoming code, else resume from the
 * refresh cookie. Returns null when the visitor is signed out.
 *
 * Memoised, and that is load-bearing rather than an optimisation. Boot is not
 * idempotent — takeHandoffCode() removes ?code= from the URL, and the code is
 * single-use — so a second concurrent call sees a URL with no code and falls
 * through to the refresh path, resolving null while the first call is still
 * redeeming. React StrictMode double-invokes effects in development, making
 * that the norm rather than a rare race. Handing every caller the SAME promise
 * means redemption happens once and everyone sees its result.
 */
export function initSession(): Promise<SessionUser | null> {
  if (!sessionInit) sessionInit = establishSession()
  return sessionInit
}

export async function signOut(): Promise<void> {
  accessToken = null
  sessionInit = null
  try {
    // Revokes the refresh token server-side and clears the cookie. Needs
    // credentials so the server can see which token to revoke.
    await fetch(`${ACCOUNT_API}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    /* ignore — the browser is signed out either way */
  }
  try {
    // A deliberate sign-out should not immediately trigger a silent resume.
    window.sessionStorage.setItem(RESUME_FLAG, '1')
  } catch {
    /* storage disabled */
  }
}

/**
 * Read `exp` out of a JWT without verifying it.
 *
 * Purely a scheduling hint for the proactive refresh below — the server still
 * verifies every token properly, so a forged `exp` here buys nothing beyond a
 * wasted refresh. Returns null for anything unparseable, treated as expired.
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
// skew between browser and API plus the round-trip itself.
const REFRESH_MARGIN_MS = 60_000

/**
 * Refresh the access token if it is expired or about to be.
 *
 * This matters more than the 401-retry below, because of what the Studio
 * sends: access tokens last 15 minutes, and a user easily spends that picking
 * languages and choosing a file before pressing Start. If the first sign that
 * the token died is a 401 on POST /api/jobs, the browser has already uploaded
 * the entire video — and the retry uploads it a second time.
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
 * check cannot catch a token revoked server-side (a logout elsewhere).
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
  return call(accessToken)
}

/**
 * Append the access token to an EventSource URL.
 *
 * EventSource takes a URL and nothing else — it cannot send an Authorization
 * header — so the SSE route accepts ?access_token= as well (see
 * backend/app/auth.py). Only the short-lived access token goes here, never
 * anything longer-lived, and the request is same-origin.
 *
 * Safe to read synchronously: every caller subscribes immediately after
 * createJob(), which has just refreshed it through authFetch.
 */
export function withAccessToken(url: string): string {
  if (!accessToken) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}access_token=${encodeURIComponent(accessToken)}`
}
