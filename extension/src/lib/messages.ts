// The message protocol between the three extension contexts.
//
//   popup ──request──▶ background ──command──▶ offscreen
//   offscreen ──event/request──▶ background
//
// The popup never talks to the offscreen document directly: the background
// owns auth and the dubbing state, and writes that state to
// chrome.storage.session, which the popup watches.

export type DubStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error'

/** Why a session ended with an error. Drives the popup's copy and links. */
export type EndKind = 'out-of-time' | 'auth' | 'unavailable' | 'capture' | 'network'

export interface DubState {
  status: DubStatus
  tabId: number | null
  /** URL of the dubbed tab when dubbing started, for the navigation rule. */
  tabUrl: string | null
  error: string | null
  errorKind: EndKind | null
}

export const IDLE: DubState = { status: 'idle', tabId: null, tabUrl: null, error: null, errorKind: null }

export interface User {
  id: number
  email: string
  name: string
}

export interface Account {
  user: User
  /** "Free", "Pro", "Studio Max"; null if the plan could not be loaded. */
  plan: string | null
  credits: number | null
  usage: RealtimeUsage | null
}

export interface RealtimeUsage {
  configured: boolean
  unlimited: boolean
  usedSecondsToday: number
  dailySeconds: number
  sessionSeconds: number
}

export interface Language {
  code: string
  name: string
}

/** POST /v1/realtime/session (contract section 3). */
export interface SessionGrant {
  model: string
  wsUrl: string
  targetLanguage: string
  maxSeconds: number
  remainingSecondsToday: number
  unlimited: boolean
}

// ── popup → background ──────────────────────────────────────────────────────
export type PopupRequest =
  | { type: 'auth/login'; email: string; password: string }
  | { type: 'auth/logout' }
  | { type: 'account/get' }
  | { type: 'languages/get' }
  | { type: 'dub/start'; tabId: number }
  | { type: 'dub/stop' }

// ── offscreen → background ──────────────────────────────────────────────────
export type OffscreenEvent =
  | { type: 'offscreen/grant'; language: string }
  | { type: 'offscreen/state'; status: 'live' | 'reconnecting' }
  | { type: 'offscreen/ended'; kind: EndKind | null; message: string | null }
  | { type: 'offscreen/ping' }

// ── background → offscreen ──────────────────────────────────────────────────
export type OffscreenCommand =
  | { target: 'offscreen'; type: 'start'; streamId: string; language: string }
  | { target: 'offscreen'; type: 'stop' }

export type Reply<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number }

/** Send a request to the background and unwrap its reply. */
export async function ask<T>(msg: PopupRequest | OffscreenEvent): Promise<T> {
  const reply = (await chrome.runtime.sendMessage(msg)) as Reply<T> | undefined
  if (!reply) throw new RequestError('The extension did not answer. Try again.')
  if (!reply.ok) throw new RequestError(reply.error, reply.status)
  return reply.data
}

export class RequestError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

// ── storage keys ────────────────────────────────────────────────────────────
/** chrome.storage.local: { accessToken, user } */
export const AUTH_KEY = 'auth'
/** chrome.storage.local: { language } */
export const SETTINGS_KEY = 'settings'
/** chrome.storage.session: DubState */
export const DUB_KEY = 'dub'

export interface Settings {
  language: string
}
