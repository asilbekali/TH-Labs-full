import type { ReactNode } from 'react'

export interface NavItem {
  to: string
  label: string
  icon: ReactNode
  /**
   * Marks a destination that exists but has nothing behind it yet, so the nav
   * can badge it instead of letting someone click through expecting a feature.
   */
  soon?: boolean
}

const ICON = {
  home: <path d="M4 10.4 12 4l8 6.4V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />,
  works: (
    <>
      <rect x="3.5" y="4" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="4" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13" width="7" height="7" rx="1.6" />
    </>
  ),
  studio: <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />,
  docs: (
    <>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H14l5 5v11.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5z" />
      <path d="M13.5 3.2V8.5H19M8.5 13h7M8.5 16.5h5" />
    </>
  ),
  billing: <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M7 15h4" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  developers: <path d="M8.5 8.5 5 12l3.5 3.5M15.5 8.5 19 12l-3.5 3.5M13.5 6.5l-3 11" />,
} as const

/**
 * The top of the sidebar: the three places there is actually something to do.
 *
 * There used to be an "Apps" group here with Dub a video / Dub a podcast /
 * Clone a voice under a Dubbing Studio row. All four opened /studio — the only
 * difference was a quality preset in router state — so the sidebar showed four
 * rows, highlighted none of them consistently, and led everywhere to the same
 * screen. The presets belong on the dashboard's quick-start cards, where they
 * read as "start this way" rather than as four separate applications. This is
 * one Studio row.
 */
export const NAV_MAIN: NavItem[] = [
  { to: '/', label: 'Home', icon: ICON.home },
  { to: '/studio', label: 'Studio', icon: ICON.studio },
  { to: '/works', label: 'My works', icon: ICON.works },
]

/**
 * Pinned to the bottom of the sidebar. These are the rows you go to
 * occasionally and want in the same place every time — which is why they sit
 * against the bottom edge rather than drifting with the length of the list
 * above them.
 */
export const NAV_BOTTOM: NavItem[] = [
  { to: '/docs', label: 'Docs', icon: ICON.docs },
  { to: '/developers', label: 'Developers', icon: ICON.developers, soon: true },
  { to: '/plans', label: 'Plans & billing', icon: ICON.billing },
  { to: '/account', label: 'Settings', icon: ICON.settings },
]

/** Everything the sidebar can reach, for the search box. */
export const NAV_ALL: NavItem[] = [...NAV_MAIN, ...NAV_BOTTOM]

/**
 * The five destinations the mobile tab bar shows. A phone has no room for the
 * full bottom group, so Docs and Developers live in the drawer there.
 */
export const NAV: NavItem[] = [
  NAV_MAIN[0],
  NAV_MAIN[1],
  NAV_MAIN[2],
  NAV_BOTTOM[2],
  NAV_BOTTOM[3],
]

/** Breadcrumb titles, so the top bar names the page without each page telling it. */
export const PAGE_TITLES: Record<string, string> = {
  '/': 'Home',
  '/studio': 'Studio',
  '/works': 'My works',
  '/plans': 'Plans & billing',
  '/plans/success': 'Payment',
  '/plans/cancel': 'Payment',
  '/account': 'Settings',
  '/docs': 'Docs',
  '/developers': 'Developers',
}

export const BELL = (
  <>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </>
)

// Stroked 24-grid icon wrapper used throughout the nav.
export function RailSvg({ icon, className = 'h-[19px] w-[19px]' }: { icon: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {icon}
    </svg>
  )
}
