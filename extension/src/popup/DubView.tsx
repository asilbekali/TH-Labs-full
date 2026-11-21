import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_LANGUAGE, DEFAULT_ORIGINAL_VOLUME, MIN_GRANT_SECONDS, PRICING_URL } from '../config'
import { LIVE_LANGUAGES } from '../lib/languages'
import {
  type Account,
  ask,
  DUB_KEY,
  type DubState,
  IDLE,
  type Language,
  SETTINGS_KEY,
  type Settings,
  type User,
} from '../lib/messages'
import { useStored } from './useStored'

const STATUS_TEXT: Record<DubState['status'], string> = {
  idle: 'Off',
  connecting: 'Connecting...',
  live: 'Live',
  reconnecting: 'Reconnecting...',
  error: 'Stopped',
}

export function DubView({ user }: { user: User }) {
  const dub = useStored<DubState>('session', DUB_KEY) ?? IDLE
  const stored = useStored<Settings>('local', SETTINGS_KEY)
  const settings: Settings = {
    language: stored?.language ?? DEFAULT_LANGUAGE,
    volume: stored?.volume ?? DEFAULT_ORIGINAL_VOLUME,
  }
  const [account, setAccount] = useState<Account | null>(null)
  const [languages, setLanguages] = useState<Language[]>(LIVE_LANGUAGES)
  const [currentTab, setCurrentTab] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const loadAccount = useCallback(() => {
    ask<Account>({ type: 'account/get' }).then(setAccount, () => {})
  }, [])

  useEffect(() => {
    loadAccount()
    ask<Language[]>({ type: 'languages/get' }).then(setLanguages, () => {})
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => setCurrentTab(tab?.id ?? null))
  }, [loadAccount])

  // Time left changes when a session starts or ends.
  useEffect(() => {
    if (dub.status === 'idle' || dub.status === 'error' || dub.status === 'live') loadAccount()
  }, [dub.status, loadAccount])

  const save = (patch: Partial<Settings>) =>
    void chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, ...patch } })

  const running = dub.status === 'connecting' || dub.status === 'live' || dub.status === 'reconnecting'
  const elsewhere = running && dub.tabId !== null && dub.tabId !== currentTab

  const usage = account?.usage
  const secondsLeft = usage ? Math.max(0, usage.dailySeconds - usage.usedSecondsToday) : null
  const blocked =
    !!usage && (!usage.configured || (!usage.unlimited && (secondsLeft ?? 0) < MIN_GRANT_SECONDS))

  async function toggle() {
    setBusy(true)
    try {
      if (running && !elsewhere) await ask({ type: 'dub/stop' })
      else if (currentTab !== null) await ask({ type: 'dub/start', tabId: currentTab })
    } catch {
      // The background reports failures through the dubbing state.
    } finally {
      setBusy(false)
    }
  }

  function setVolume(volume: number) {
    save({ volume })
    if (running) void ask({ type: 'dub/volume', volume }).catch(() => {})
  }

  const on = running && !elsewhere

  return (
    <>
      <section className="card account">
        <div className="account-top">
          <div className="who">
            <div className="name">{user.name || user.email}</div>
            {user.name && <div className="muted small">{user.email}</div>}
          </div>
          {account?.plan && <span className="tag">{account.plan}</span>}
        </div>
        <div className="stats">
          <div>
            <div className="label">Live time left today</div>
            <div className="number">
              {usage?.unlimited ? 'No limit' : secondsLeft === null ? '-' : `${Math.floor(secondsLeft / 60)} min`}
            </div>
          </div>
          <div>
            <div className="label">Credits</div>
            <div className="number small-number">{account?.credits ?? '-'}</div>
          </div>
        </div>
      </section>

      <section className="card controls">
        <label className="field">
          <span>I want to hear in</span>
          <select
            value={settings.language}
            disabled={running}
            onChange={(e) => save({ language: e.target.value })}
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        {running && <p className="muted small">Turn dubbing off to change the language.</p>}

        <button
          type="button"
          role="switch"
          aria-checked={on}
          className={`switch ${on ? 'on' : ''}`}
          disabled={busy || currentTab === null || (!running && blocked)}
          onClick={() => void toggle()}
        >
          <span className="switch-text">
            <span className="switch-title">Real-time dubbing</span>
            <span className={`status status-${dub.status}`}>
              {elsewhere ? 'Live in another tab' : STATUS_TEXT[dub.status]}
            </span>
          </span>
          <span className="track" aria-hidden>
            <span className="knob" />
          </span>
        </button>
        {elsewhere && <p className="muted small">Turning it on here stops the other tab first.</p>}

        {dub.status === 'error' && dub.error && (
          <p className="error" role="alert">
            {dub.error}
            {dub.errorKind === 'out-of-time' && (
              <>
                {' '}
                <a href={PRICING_URL} target="_blank" rel="noreferrer">See plans at th-labs.uz</a>
              </>
            )}
          </p>
        )}
        {!running && usage && !usage.configured && (
          <p className="error">Live dubbing is unavailable right now. Try again later.</p>
        )}

        <label className="field">
          <span>
            Original audio <span className="muted">{Math.round(settings.volume * 100)}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
      </section>

      <p className="tip">Use headphones in meetings so others don't hear the dubbed voice through your microphone.</p>

      <button className="btn btn-ghost wide" type="button" onClick={() => void ask({ type: 'auth/logout' })}>
        Log out
      </button>
    </>
  )
}
