import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_LANGUAGE, MIN_GRANT_SECONDS, PRICING_URL } from '../config'
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
import { LanguagePicker } from './LanguagePicker'
import { useShortcut } from './useShortcut'
import { useStored } from './useStored'

const STATUS_TEXT: Record<DubState['status'], string> = {
  idle: 'Off',
  connecting: 'Connecting...',
  live: 'Live',
  reconnecting: 'Reconnecting...',
  error: 'Stopped',
}

/** Server values shown as text: anything that is not a string or number renders as nothing. */
const text = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '')

export function DubView({ user }: { user: User }) {
  const dub = useStored<DubState>('session', DUB_KEY) ?? IDLE
  const stored = useStored<Settings>('local', SETTINGS_KEY)
  const settings: Settings = {
    language: stored?.language ?? DEFAULT_LANGUAGE,
  }
  const [account, setAccount] = useState<Account | null>(null)
  const [languages, setLanguages] = useState<Language[]>(LIVE_LANGUAGES)
  const [currentTab, setCurrentTab] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const shortcut = useShortcut()

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
  const freeUsed = !!usage && !usage.unlimited && (secondsLeft ?? 0) < MIN_GRANT_SECONDS
  const canPay = (usage?.affordableSeconds ?? 0) >= MIN_GRANT_SECONDS
  const blocked = !!usage && (!usage.configured || (freeUsed && !canPay))

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

  const on = running && !elsewhere

  const leftRatio = usage && !usage.unlimited && usage.dailySeconds > 0 ? (secondsLeft ?? 0) / usage.dailySeconds : null
  // TODO(human): decide when the time-left meter should turn to the warning colour.
  const lowTime = false
  const displayName = text(user.name) || text(user.email) || 'Your account'
  const initial = displayName.charAt(0).toUpperCase()

  return (
    <>
      <section className="glass card hero">
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
            <span className={`status status-${elsewhere ? 'idle' : dub.status}`}>
              <span className="dot" aria-hidden />
              {elsewhere ? 'Live in another tab' : STATUS_TEXT[dub.status]}
            </span>
          </span>
          <span className="track" aria-hidden>
            <span className="knob" />
          </span>
        </button>
        {elsewhere && <p className="muted small">Turning it on here stops the other tab first.</p>}
        {shortcut && !elsewhere && (
          <p className="hint">
            Press <kbd>{shortcut}</kbd> on any tab to turn dubbing on or off
          </p>
        )}

        <div className="field">
          <span>I want to hear in</span>
          <LanguagePicker
            value={settings.language}
            languages={languages}
            disabled={running}
            onChange={(language) => save({ language })}
          />
        </div>
        {running && <p className="muted small">Turn dubbing off to change the language.</p>}

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
        {usage?.configured && freeUsed && canPay && usage.creditsPerMinute && (
          <p className="muted small">Today's free minutes are used. Live dubbing now costs {usage.creditsPerMinute} tokens a minute.</p>
        )}
        {!running && usage?.configured && blocked && dub.status !== 'error' && (
          <p className="muted small">
            Today's free minutes are used. <a href={PRICING_URL} target="_blank" rel="noreferrer">Top up tokens</a> or come back tomorrow.
          </p>
        )}
        {!running && usage && !usage.configured && (
          <p className="error">Live dubbing is unavailable right now. Try again later.</p>
        )}
      </section>

      <section className="glass card account">
        <div className="account-top">
          <div className="who">
            <span className="avatar" aria-hidden>{initial}</span>
            <div className="who-text">
              <div className="name">{displayName}</div>
              {text(user.name) && text(user.email) && <div className="muted small">{text(user.email)}</div>}
            </div>
          </div>
          {text(account?.plan) && <span className="tag">{text(account?.plan)}</span>}
        </div>
        <div className="stats">
          <div>
            <div className="label">Free time left today</div>
            <div className="number">
              {usage?.unlimited ? 'No limit' : secondsLeft === null ? '-' : `${Math.floor(secondsLeft / 60)} min`}
            </div>
            {leftRatio !== null && (
              <div className={`meter ${lowTime ? 'low' : ''}`} aria-hidden>
                <span style={{ width: `${Math.round(leftRatio * 100)}%` }} />
              </div>
            )}
          </div>
          <div>
            <div className="label">Tokens</div>
            <div className="number small-number">{text(account?.credits) || '-'}</div>
          </div>
        </div>
      </section>

      <p className="tip">🎧 Use headphones in meetings so others don't hear the dubbed voice through your microphone.</p>

      <button className="btn btn-ghost wide" type="button" onClick={() => void ask({ type: 'auth/logout' })}>
        Log out
      </button>
    </>
  )
}
