// REST calls to the TH-Labs account API. Service worker only (see auth.ts).
import { API_BASE } from '../config'
import { clearAuth, getAuth, refresh, setAuth, toUser } from './auth'
import { LIVE_LANGUAGES } from './languages'
import type { Account, Language, RealtimeUsage, SessionGrant, User } from './messages'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const OFFLINE = "Can't reach th-labs.uz. Check your connection."
const SIGNED_OUT = 'Your session ended. Please log in again.'

/** Nest error bodies carry `message` as a string or a list of strings. */
function messageOf(body: unknown, fallback: string): string {
  const m = (body as { message?: unknown } | null)?.message
  if (typeof m === 'string') return m
  if (Array.isArray(m) && typeof m[0] === 'string') return m[0]
  return fallback
}

async function send(path: string, init: RequestInit, token?: string): Promise<Response> {
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  try {
    return await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' })
  } catch {
    throw new ApiError(0, OFFLINE)
  }
}

/**
 * An authenticated call. On 401 it refreshes once and retries once; if that
 * fails too the user is signed out (which also stops any dubbing).
 */
async function authed<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = await getAuth()
  if (!auth) throw new ApiError(401, SIGNED_OUT)
  let res = await send(path, init, auth.accessToken)
  if (res.status === 401) {
    let fresh
    try {
      fresh = await refresh()
    } catch {
      await clearAuth()
      throw new ApiError(401, SIGNED_OUT)
    }
    res = await send(path, init, fresh.accessToken)
    if (res.status === 401) {
      await clearAuth()
      throw new ApiError(401, SIGNED_OUT)
    }
  }
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, messageOf(body, `Request failed (${res.status})`))
  return body as T
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export async function login(email: string, password: string): Promise<User> {
  const res = await send('/auth/login', json({ email, password }))
  const body: unknown = await res.json().catch(() => null)
  if (res.status === 401) throw new ApiError(401, 'Wrong email or password.')
  if (res.status === 400) throw new ApiError(400, 'Enter a valid email and a password of at least 8 characters.')
  if (!res.ok) throw new ApiError(res.status, messageOf(body, 'Could not log in. Try again.'))
  const { accessToken, user } = body as { accessToken: string; user: User }
  await setAuth({ accessToken, user: toUser(user) })
  return toUser(user)
}

/** Revokes the refresh cookie on the server. Best effort: local sign-out happens regardless. */
export async function logout(): Promise<void> {
  try {
    await send('/auth/logout', { method: 'POST' })
  } finally {
    await clearAuth()
  }
}

export async function getAccount(): Promise<Account> {
  const [me, plan, credits, usage] = await Promise.allSettled([
    authed<User>('/auth/me'),
    authed<{ tierName: string }>('/payments/entitlements'),
    authed<{ balance: number }>('/payments/credits?page=1&limit=1'),
    authed<RealtimeUsage>('/realtime/usage'),
  ])
  // Only who the user is matters enough to fail the whole call.
  if (me.status === 'rejected') throw me.reason
  return {
    user: toUser(me.value),
    plan: plan.status === 'fulfilled' ? plan.value.tierName : null,
    credits: credits.status === 'fulfilled' ? credits.value.balance : null,
    usage: usage.status === 'fulfilled' ? usage.value : null,
  }
}

/** The catalog languages live dubbing accepts, in the catalog's order. */
export async function getLanguages(): Promise<Language[]> {
  try {
    const res = await send('/languages', {})
    if (!res.ok) return LIVE_LANGUAGES
    const { languages } = (await res.json()) as { languages: Language[] }
    const live = new Set(LIVE_LANGUAGES.map((l) => l.code))
    const list = languages.filter((l) => live.has(l.code)).map(({ code, name }) => ({ code, name: typeof name === 'string' ? name : (LIVE_LANGUAGES.find((l) => l.code === code)?.name ?? code) }))
    return list.length ? list : LIVE_LANGUAGES
  } catch {
    return LIVE_LANGUAGES
  }
}

/** POST /v1/realtime/session. Spends free time, or tokens once that is used, so call it only right before opening the socket. */
export function startSession(targetLanguage: string): Promise<SessionGrant> {
  return authed<SessionGrant>('/realtime/session', json({ targetLanguage }))
}
