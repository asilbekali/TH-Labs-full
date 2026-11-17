// Tells the account API which page this tab is on, so the admin panel's
// Agent City can show who is in the Studio, who is on Plans, and so on.
//
// One beat on every navigation (counted as a page view) and one every 20s
// while the tab stays open and visible. A hidden tab stops beating and drops
// off the map within a minute — someone with the Studio in a background tab
// is not "in the Studio". Fire-and-forget: presence must never cost a page a
// render or an error toast, so every failure is swallowed.
import { useEffect } from 'react'
import { apiUrl, getAccessToken } from './http'

const BEAT_MS = 20_000
const VISITOR_KEY = 'th:visitor-id'

let doing: string | null = null
let beatNow: (() => void) | null = null

/**
 * What the person is doing right now, in a few words ("Dubbing intro.mp4 into
 * Uzbek"). Pages call this when they know; null goes back to just the page.
 */
export function setPresenceActivity(text: string | null): void {
  if (text === doing) return
  doing = text
  beatNow?.()
}

function visitorId(): string {
  try {
    const kept = window.localStorage.getItem(VISITOR_KEY)
    if (kept) return kept
    const fresh = `v_${crypto.randomUUID().replace(/-/g, '')}`
    window.localStorage.setItem(VISITOR_KEY, fresh)
    return fresh
  } catch {
    // Private mode: a per-load id still shows them on the map; they are just
    // counted again if they reload.
    return `v_${Math.random().toString(36).slice(2, 14)}`
  }
}

function send(path: string, pageview: boolean) {
  const token = getAccessToken()
  void fetch(apiUrl('/presence'), {
    method: 'POST',
    keepalive: true,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ visitorId: visitorId(), site: 'app', path, doing: doing ?? undefined, pageview }),
  }).catch(() => {})
}

/** Mounted once, in AppShell. `enabled` is "signed in" — the door is above. */
export function usePresenceBeacon(pathname: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    // A new page is a new activity until that page says otherwise.
    doing = null
    send(pathname, true)
    beatNow = () => send(pathname, false)

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') send(pathname, false)
    }, BEAT_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') send(pathname, false)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      beatNow = null
    }
  }, [pathname, enabled])
}
