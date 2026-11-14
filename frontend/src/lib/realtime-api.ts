// Client for the account API's live translation endpoints (/v1/realtime).
// The API only hands out a session; the audio itself goes straight from the
// browser to Google (lib/live-translate.ts).
import { authJson } from './http'

/** POST /v1/realtime/session — mirrors api/src/realtime/realtime.service.ts. */
export interface RealtimeSessionGrant {
  token: string
  model: string
  /** Gemini Live socket, already carrying the one-use token. */
  wsUrl: string
  /** Google's code the session is locked to (e.g. "uz", "zh-Hans"). */
  targetLanguage: string
  expiresAt: string
  /** The session ends itself after this many seconds. */
  maxSeconds: number
  remainingSecondsToday: number
  /** No daily allowance on this account. */
  unlimited?: boolean
}

/** GET /v1/realtime/usage */
export interface RealtimeUsage {
  configured: boolean
  unlimited?: boolean
  usedSecondsToday: number
  dailySeconds: number
  sessionSeconds: number
}

export function startRealtimeSession(targetLanguage: string): Promise<RealtimeSessionGrant> {
  return authJson<RealtimeSessionGrant>(
    '/realtime/session',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLanguage }),
    },
    'Could not start live translation',
  )
}

export function getRealtimeUsage(): Promise<RealtimeUsage> {
  return authJson<RealtimeUsage>('/realtime/usage', {}, 'Could not load live translation usage')
}
