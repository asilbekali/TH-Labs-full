// Where the app hands a visitor back to.
//
// The landing site (th-labs.uz) and this app are separate deployments on
// separate origins — the landing page owns marketing, the waitlist/community
// signup form and sign-in, and hands a session over via a one-time handoff code
// (see the handoff notes in auth.tsx). This app has no marketing pages of its
// own and deliberately does not grow any.
//
// So signing out is a boundary crossing, not a route change: a signed-out user
// has nothing to look at in here. `leaveToLanding` is what makes that one line
// of policy rather than something each sign-out button remembers separately.
//
// Mirrors backend/app/config.py's `landing_url`, which has the same default for
// the same reason.
const FALLBACK = 'https://th-labs.uz'

/** The landing site's origin, overridable per deployment with VITE_LANDING_URL. */
export const LANDING_URL: string = (
  import.meta.env.VITE_LANDING_URL?.trim() || FALLBACK
).replace(/\/+$/, '')

/**
 * Send the browser to the landing page.
 *
 * `location.replace`, not `assign`: the page being left is a signed-out app
 * route, so leaving it in history means the back button returns to a shell that
 * immediately bounces the user out again.
 *
 * Guarded for a non-browser context (tests, SSR) so importing this module is
 * never itself a navigation hazard.
 */
export function leaveToLanding(path = '/'): void {
  if (typeof window === 'undefined') return
  window.location.replace(`${LANDING_URL}${path.startsWith('/') ? path : `/${path}`}`)
}
