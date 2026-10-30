import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Sidebar from '../nav/Sidebar'
import TopBar from '../nav/TopBar'
import MobileTabBar from '../nav/MobileTabBar'
import LogoLoader from '../brand/LogoLoader'
import SignIn from '../../pages/SignIn'
import { useIsDesktop } from '../../hooks/useMediaQuery'
import { useAuth } from '../../lib/auth'
import { leaveToLanding, LOCAL_AUTH } from '../../lib/landing'

// Routes that render as their own workbench on desktop: they own two or three
// internally-scrolling regions, so they take the content area raw instead of
// being wrapped in the centred, scrolling column every other page gets.
const WORKBENCH_ROUTES = ['/studio', '/works']

const COLLAPSE_KEY = 'th:sidebar-collapsed'

/**
 * The app frame: sidebar, top bar, page.
 *
 * It is also the door. This deployment is the signed-in panel and nothing else
 * — marketing, sign-in and registration all live on the landing site — so an
 * unauthenticated visitor is not shown a sign-in form here, they are handed
 * back to th-labs.uz. Putting that in the shell rather than on each route means
 * no page can be added later that forgets it.
 *
 * The one exception is LOCAL_AUTH (src/lib/landing.ts, on in `vite dev` only),
 * where the door opens inward instead: a signed-out visitor gets the in-app
 * sign-in screen. Without it a dev server is unreachable — it has no session,
 * so the gate below redirects off the origin before you can look at anything.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const isDesktop = useIsDesktop()
  const { user, ready } = useAuth()

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [drawer, setDrawer] = useState(false)

  const workbench = WORKBENCH_ROUTES.includes(pathname) && isDesktop

  // The shell is always exactly one viewport tall and the CONTENT column is the
  // scroller — the document itself never scrolls.
  //
  // That is what keeps the sidebar still. It used to be a stretched child of a
  // `min-h-screen` row, so on a long page it scrolled away with everything else
  // and, because `h-full` against an auto-height parent resolves to the child's
  // own content height, it also stopped short of the bottom edge instead of
  // reaching it. Giving the frame a definite height fixes both at once: the nav
  // is pinned, its bottom group sits on the bottom edge, and the page scrolls
  // underneath the top bar.
  //
  // `h-dvh`, not `h-screen`: on mobile Safari `100vh` is the height with the
  // address bar hidden, so a `100vh` frame with an internal scroller puts the
  // last ~60px of every page permanently under the browser chrome.
  useEffect(() => {
    document.body.dataset.shell = 'fixed'
    return () => {
      delete document.body.dataset.shell
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* private mode — the preference is simply not remembered */
    }
  }, [collapsed])

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setDrawer(false), [pathname])

  // ── The door ──────────────────────────────────────────────────────────────
  // `ready` is load-bearing. The session is restored asynchronously (a handoff
  // code redemption, or /auth/refresh with the httpOnly cookie), so for the
  // first moment of every reload a signed-in user is indistinguishable from a
  // signed-out one. Redirecting during that window would bounce people who are
  // already signed in — including the ones arriving from the landing page with
  // a valid handoff code in the URL.
  // Only when there is nowhere in here to sign in. Under LOCAL_AUTH the screen
  // below takes over instead — but signing out still leaves for the landing
  // site, because `logout()` calls leaveToLanding directly and that function is
  // unconditional. Arriving without a session and choosing to go are different
  // things.
  useEffect(() => {
    if (ready && !user && !LOCAL_AUTH) leaveToLanding()
  }, [ready, user])

  // Signed out, and there is somewhere in here to sign in: show it. Only ever
  // after `ready`, for the reason above — during the bootstrap window a
  // signed-in user looks signed out, and flashing a login form at someone who
  // is already authenticated is the same bug as redirecting them.
  if (ready && !user && LOCAL_AUTH) return <SignIn />

  if (!ready || !user) {
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <div className="text-center">
          <LogoLoader size="lg" className="text-primary" />
          <p className="mt-5 text-sm text-secondary">
            {ready ? 'Taking you back to th-labs.uz…' : 'Checking your session…'}
          </p>
        </div>
      </div>
    )
  }

  const sidebarLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar'

  const page = (
    <>
      {/* Desktop sidebar. Hidden below lg, where the drawer and the tab bar
          take over. */}
      <Sidebar compact={collapsed} className="hidden h-full lg:flex" />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Below lg the bar's menu button opens the drawer. The tab bar carries
            five destinations; Docs, Developers and Settings are not among them,
            so a phone needs another way to the full sidebar. */}
        <TopBar
          onToggleSidebar={() => setCollapsed((v) => !v)}
          onOpenMenu={() => setDrawer(true)}
          sidebarLabel={sidebarLabel}
        />

        <main
          className={
            workbench
              ? 'min-h-0 flex-1 overflow-hidden px-4 py-4 xl:px-6'
              : 'min-h-0 flex-1 overflow-y-auto'
          }
        >
          {workbench ? (
            children
          ) : (
            // `pb-32` on the inner box rather than on <main>: padding on a
            // scroll container is not always honoured at the end of the scroll
            // range, and the mobile tab bar would sit on top of the last card.
            <div className="mx-auto w-full max-w-[1180px] px-4 py-5 pb-32 sm:px-7 sm:py-6 lg:pb-10">
              {children}
            </div>
          )}
        </main>
      </div>
    </>
  )

  return (
    <>
      <div className="flex h-dvh overflow-hidden">{page}</div>

      {/* Mobile drawer — the same sidebar, slid in over the page. */}
      <AnimatePresence>
        {drawer && (
          <>
            <motion.button
              type="button"
              aria-label="Close menu"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawer(false)}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden"
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 420, damping: 38 }}
              className="fixed inset-y-0 left-0 z-50 lg:hidden"
            >
              <Sidebar
                compact={false}
                className="flex h-full pt-[calc(env(safe-area-inset-top)+1rem)] shadow-[var(--shadow-lg)]"
                onNavigate={() => setDrawer(false)}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <MobileTabBar />
    </>
  )
}
