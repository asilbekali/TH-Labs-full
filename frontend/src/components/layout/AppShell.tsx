import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import AuthModal from '../AuthModal'
import IconRail from '../nav/IconRail'
import TopBar from '../nav/TopBar'
import MobileTabBar from '../nav/MobileTabBar'
import ScrollColumn from './ScrollColumn'
import { useIsDesktop } from '../../hooks/useMediaQuery'

// Routes that render as fixed-height app shells on desktop (§2). Account stays
// a scrolling document; Home is a launchpad that fills the page area (01).
const FIXED_ROUTES = ['/', '/studio', '/works', '/plans']

/**
 * The app frame. On desktop + a fixed route it renders the §2 shell: a full
 * `100vh` grid with the rail as an `h-full` column beside a
 * `grid-rows-[auto_minmax(0,1fr)]` content column, so the rail cap, the CTA and
 * the right column's last card all land on the same line — nothing to measure.
 * Everywhere else (Home, Account, and anything < lg) it is a normal scrolling
 * document with a sticky rail and the mobile tab bar.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const [authOpen, setAuthOpen] = useState(false)
  const { pathname } = useLocation()
  const isDesktop = useIsDesktop()

  const isFixedRoute = FIXED_ROUTES.includes(pathname)
  const fixedShell = isFixedRoute && isDesktop

  // Lock body scroll on the fixed shell (CSS scopes this to lg via [data-shell]).
  useEffect(() => {
    document.body.dataset.shell = isFixedRoute ? 'fixed' : 'scroll'
    return () => {
      delete document.body.dataset.shell
    }
  }, [isFixedRoute])

  const onSignIn = () => setAuthOpen(true)

  if (fixedShell) {
    return (
      <>
        <div className="grid h-screen grid-cols-[68px_minmax(0,1fr)] gap-4 overflow-hidden p-4">
          <IconRail className="h-full" onSignIn={onSignIn} />
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
            <TopBar onSignIn={onSignIn} />
            <div className="min-h-0">
              {/* Studio and My works manage their own internal-scroll regions
                  (Studio's two columns + CTA; Works' fixed header/filter rows over
                  a scrolling results area). Other fixed routes scroll as a single
                  column inside the area. */}
              {pathname === '/studio' || pathname === '/works' ? (
                children
              ) : (
                <ScrollColumn className="pb-1">{children}</ScrollColumn>
              )}
            </div>
          </div>
        </div>
        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      </>
    )
  }

  return (
    <>
      <div className="min-h-screen lg:flex">
        <IconRail
          className="sticky top-4 my-4 ml-4 h-[calc(100vh-2rem)] self-start"
          onSignIn={onSignIn}
        />
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30">
            <div className="wrap py-3.5">
              <TopBar onSignIn={onSignIn} />
            </div>
          </header>
          <main className="wrap pb-28 pt-2 lg:pb-12">{children}</main>
        </div>
      </div>
      <MobileTabBar />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  )
}
