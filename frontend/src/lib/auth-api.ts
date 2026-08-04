// Client for the TH-Labs account API (NestJS, mounted under /v1).
//
// Auth is cookie-based: login/register return an access token in the body
// (kept in memory) and set an httpOnly refresh cookie. Every call opts into
// credentials so that cookie is set and sent. The base URL and the shared
// authenticated fetch live in ./http.
import { apiUrl, authJson, readError, setAccessToken } from './http'

export type Role = 'USER' | 'ADMIN' | 'SUPERADMIN'

export interface AccountUser {
  id: number
  email: string
  name: string
  role: Role
  createdAt: string
}

// The refresh token is no longer in the body — it is an httpOnly cookie.
export interface AuthResponse {
  accessToken: string
  user: AccountUser
}

// login / register / logout do NOT go through the 401-retry wrapper: a failed
// login is itself a 401 and must surface as an error, not trigger a refresh.
export async function login(email: string, password: string): Promise<AuthResponse> {
  const r = await fetch(apiUrl('/auth/login'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!r.ok) throw new Error(await readError(r, 'Login failed'))
  const data = (await r.json()) as AuthResponse
  setAccessToken(data.accessToken)
  return data
}

// Registration is "create a user account" on the API — it issues tokens
// immediately (no separate login step) and sets the refresh cookie.
export async function register(
  name: string,
  email: string,
  password: string,
): Promise<AuthResponse> {
  const r = await fetch(apiUrl('/users/create-user'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  })
  if (!r.ok) throw new Error(await readError(r, 'Could not create account'))
  const data = (await r.json()) as AuthResponse
  setAccessToken(data.accessToken)
  return data
}

export async function logout(): Promise<void> {
  await fetch(apiUrl('/auth/logout'), {
    method: 'POST',
    credentials: 'include',
  }).catch(() => {
    /* best-effort: even if the server call fails we still clear locally */
  })
  setAccessToken(null)
}

// Current user — used to re-hydrate context after a silent refresh if needed.
export async function me(): Promise<AccountUser> {
  return authJson<AccountUser>('/auth/me', {}, 'Could not load your account')
}

export async function updateAccount(
  id: number,
  data: { name?: string; email?: string },
): Promise<AccountUser> {
  return authJson<AccountUser>(
    `/users/${id}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
    'Could not update your account',
  )
}
