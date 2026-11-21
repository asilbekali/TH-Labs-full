// Session storage and refresh. Runs in the service worker only.
//
// The access token (15 min) and the user live in chrome.storage.local. The
// refresh token is an httpOnly cookie on th-labs.uz/v1/auth: the extension
// cannot read it, it just sends `credentials: 'include'` and the browser
// attaches it (contract Q6).
//
// The server treats a reused refresh token as theft and revokes every session
// of that user. So refreshes are single-flight: concurrent 401s share one
// rotation instead of each spending the same cookie.
import { API_BASE } from '../config'
import { AUTH_KEY, type User } from './messages'

export interface StoredAuth {
  accessToken: string
  user: User
}

export async function getAuth(): Promise<StoredAuth | null> {
  const got = await chrome.storage.local.get(AUTH_KEY)
  return (got[AUTH_KEY] as StoredAuth | undefined) ?? null
}

export async function setAuth(auth: StoredAuth): Promise<void> {
  await chrome.storage.local.set({ [AUTH_KEY]: auth })
}

/** Signs out locally. The background reacts to this key disappearing. */
export async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove(AUTH_KEY)
}

export function toUser(raw: { id: number; email: string; name: string }): User {
  return { id: raw.id, email: raw.email, name: raw.name }
}

let inflight: Promise<StoredAuth> | null = null

/** New access token from the refresh cookie. Rejects if the session is over. */
export function refresh(): Promise<StoredAuth> {
  inflight ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
      if (!res.ok) throw new Error(`refresh ${res.status}`)
      const body = (await res.json()) as { accessToken: string; user: User }
      const auth = { accessToken: body.accessToken, user: toUser(body.user) }
      await setAuth(auth)
      return auth
    } finally {
      inflight = null
    }
  })()
  return inflight
}
