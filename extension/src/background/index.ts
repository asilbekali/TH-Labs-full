// The service worker: auth, orchestration, messaging.
//
// It can be killed whenever it is idle, so nothing important lives in module
// variables: the dubbing state is in chrome.storage.session and the offscreen
// document pings it while a session runs.
import { ApiError, getAccount, getLanguages, login, logout, startSession } from '../lib/api'
import { log } from '../lib/log'
import {
  AUTH_KEY,
  DUB_KEY,
  IDLE,
  type DubState,
  type EndKind,
  type OffscreenCommand,
  type OffscreenEvent,
  type PopupRequest,
  type Reply,
  SETTINGS_KEY,
  type Settings,
} from '../lib/messages'
import { DEFAULT_LANGUAGE } from '../config'
import { shouldStopOnNavigation } from './navigation'

const OFFSCREEN_PATH = 'offscreen.html'
const COPPER = '#C8794A'

// ── state ───────────────────────────────────────────────────────────────────

async function getState(): Promise<DubState> {
  const got = await chrome.storage.session.get(DUB_KEY)
  return (got[DUB_KEY] as DubState | undefined) ?? IDLE
}

async function setState(patch: Partial<DubState>): Promise<DubState> {
  const next = { ...(await getState()), ...patch }
  await chrome.storage.session.set({ [DUB_KEY]: next })
  await paintBadge(next)
  return next
}

async function getSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(SETTINGS_KEY)
  const s = got[SETTINGS_KEY] as Partial<Settings> | undefined
  return { language: s?.language ?? DEFAULT_LANGUAGE }
}

async function paintBadge(state: DubState): Promise<void> {
  const text = state.status === 'live' ? 'ON' : state.status === 'connecting' || state.status === 'reconnecting' ? '...' : ''
  await chrome.action.setBadgeText({ text })
  if (text) await chrome.action.setBadgeBackgroundColor({ color: state.status === 'live' ? COPPER : '#5A5660' })
  if (text) await chrome.action.setBadgeTextColor?.({ color: '#FFFFFF' })
}

// ── offscreen document ──────────────────────────────────────────────────────

let creating: Promise<void> | null = null

async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  })
  return contexts.length > 0
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: 'Capture the tab audio, stream it for translation and play the dubbed voice.',
    })
    .finally(() => {
      creating = null
    })
  await creating
}

async function closeOffscreen(): Promise<void> {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument().catch(() => {})
}

/** The offscreen script may still be loading right after createDocument; retry briefly. */
async function tellOffscreen(cmd: OffscreenCommand): Promise<void> {
  for (let i = 0; i < 10; i++) {
    try {
      await chrome.runtime.sendMessage(cmd)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 50))
    }
  }
  throw new Error('The audio engine did not start.')
}

// ── dubbing lifecycle ───────────────────────────────────────────────────────

const UNCAPTURABLE = /^(chrome|chrome-extension|edge|about|devtools|view-source):|^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/

async function startDub(tabId: number): Promise<void> {
  const current = await getState()
  if (current.status !== 'idle' && current.status !== 'error') await stopDub()

  const tab = await chrome.tabs.get(tabId)
  if (!tab.url || UNCAPTURABLE.test(tab.url)) {
    await setState({ ...IDLE, status: 'error', error: "Chrome doesn't allow dubbing this page. Open a call, a stream or a video.", errorKind: 'capture' })
    return
  }

  await setState({ ...IDLE, status: 'connecting', tabId, tabUrl: tab.url })
  try {
    // @types/chrome only types the callback form of this API.
    const streamId = await new Promise<string>((ok, fail) =>
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) =>
        chrome.runtime.lastError ? fail(new Error(chrome.runtime.lastError.message)) : ok(id),
      ),
    )
    await ensureOffscreen()
    const { language } = await getSettings()
    await tellOffscreen({ target: 'offscreen', type: 'start', streamId, language })
  } catch (err) {
    log('start failed', err)
    await finish('capture', "Couldn't capture this tab's audio. Reload the tab and try again.")
  }
}

async function stopDub(): Promise<void> {
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' } satisfies OffscreenCommand).catch(() => {})
  await closeOffscreen()
  await setState(IDLE)
}

/** A session ended on its own: show why (or nothing, for a clean end). */
async function finish(kind: EndKind | null, message: string | null): Promise<void> {
  await closeOffscreen()
  await setState(message ? { ...IDLE, status: 'error', error: message, errorKind: kind } : IDLE)
}

// ── messages ────────────────────────────────────────────────────────────────

async function handle(msg: PopupRequest | OffscreenEvent): Promise<unknown> {
  switch (msg.type) {
    case 'auth/login':
      return login(msg.email, msg.password)
    case 'auth/logout':
      await stopDub()
      await logout()
      return null
    case 'account/get':
      return getAccount()
    case 'languages/get':
      return getLanguages()
    case 'dub/start':
      await startDub(msg.tabId)
      return getState()
    case 'dub/stop':
      await stopDub()
      return getState()
    case 'offscreen/grant':
      return startSession(msg.language)
    case 'offscreen/state': {
      // A late event from a document that is being shut down must not revive the state.
      const { status } = await getState()
      if (status !== 'idle' && status !== 'error') await setState({ status: msg.status, error: null, errorKind: null })
      return null
    }
    case 'offscreen/ended':
      await finish(msg.kind, msg.message)
      return null
    case 'offscreen/ping':
      return null
  }
}

chrome.runtime.onMessage.addListener((msg: { target?: string; type?: string }, _sender, sendResponse) => {
  // Commands for the offscreen document also reach this listener; ignore them.
  if (msg?.target === 'offscreen' || typeof msg?.type !== 'string') return false
  handle(msg as PopupRequest | OffscreenEvent).then(
    (data) => sendResponse({ ok: true, data } satisfies Reply),
    (err: unknown) => {
      const status = err instanceof ApiError ? err.status : undefined
      const error = err instanceof Error ? err.message : 'Something went wrong.'
      sendResponse({ ok: false, error, status } satisfies Reply)
    },
  )
  return true // the reply is async
})

// ── tab and auth events ─────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState()
  if (state.tabId === tabId && state.status !== 'idle') await stopDub()
})

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (!change.url) return
  const state = await getState()
  if (state.tabId !== tabId || state.status === 'idle' || state.status === 'error') return
  if (shouldStopOnNavigation(state.tabUrl ?? '', change.url)) await stopDub()
})

// Signed out anywhere (logout, refresh failed): no session may keep running.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && changes[AUTH_KEY] && !changes[AUTH_KEY].newValue) {
    const state = await getState()
    if (state.status !== 'idle' && state.status !== 'error') await stopDub()
  }
})

// A browser restart drops the offscreen document but not always the badge.
chrome.runtime.onStartup.addListener(() => void setState(IDLE))
chrome.runtime.onInstalled.addListener(() => void setState(IDLE))
