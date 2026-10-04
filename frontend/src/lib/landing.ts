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
 * Let a visitor with no account sign in INSIDE this app, instead of being handed
 * to the landing site to do it.
 *
 * Why this exists: that boundary makes the app untestable on localhost. A dev
 * server at http://localhost:5173 has no session, so the gate in AppShell
 * immediately redirects to https://th-labs.uz — you cannot even reach the pages
 * you are working on, and the only way in is to sign in on the production site
 * and be handed back, which does not reach a local build at all. When this is
 * on, a signed-out visitor gets the in-app sign-in screen (src/pages/SignIn).
 *
 * It covers ARRIVING without a session, and nothing else. Signing out is still
 * a boundary crossing and still leaves for the landing site — see
 * `leaveToLanding`, which is unconditional on purpose.
 *
 * Default: ON in `vite dev`, OFF in a production build. So the deployed Studio
 * keeps the single front door it is designed around — this cannot ship by
 * accident — while localhost is usable. `VITE_LOCAL_AUTH=true|false` overrides
 * either way (true is useful for `vite preview`; false restores the redirect in
 * dev to test the real handoff).
 *
 * The flag is read HERE, once, rather than at each call site, for the same
 * reason the redirect itself lives here: a third place that checks it is a
 * third place that can forget to.
 */
export const LOCAL_AUTH: boolean = (() => {
  const flag = import.meta.env.VITE_LOCAL_AUTH?.trim()
  if (flag === 'true') return true
  if (flag === 'false') return false
  return import.meta.env.DEV === true
})()

/**
 * Send the browser to the landing page.
 *
 * `location.replace`, not `assign`: the page being left is a signed-out app
 * route, so leaving it in history means the back button returns to a shell that
 * immediately bounces the user out again.
 *
 * A no-op under LOCAL_AUTH — there is a signed-out destination in here then,
 * and leaving for th-labs.uz is exactly what that mode exists to stop.
 *
 * Guarded for a non-browser context (tests, SSR) so importing this module is
 * never itself a navigation hazard.
 */
export function leaveToLanding(path = '/'): void {
  if (LOCAL_AUTH) return
  if (typeof window === 'undefined') return
  window.location.replace(`${LANDING_URL}${path.startsWith('/') ? path : `/${path}`}`)
}
