import type { ReactNode } from 'react'

export interface NavItem {
  to: string
  label: string
  icon: ReactNode
  /** A shorter label for the phone tab bar, where a tab is ~70px wide. */
  short?: string
  /**
   * Marks a destination that exists but has nothing behind it yet, so the nav
   * can badge it instead of letting someone click through expecting a feature.
   */
  soon?: boolean
}

const ICON = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  works: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  studio: (
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
    </>
  ),
  docs: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" />
      <path d="M4 19.5V21h16" />
    </>
  ),
  billing: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <path d="M2 10h20" />
    </>
  ),
  settings: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  tts: <path d="M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3" />,
  developers: <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />,
  me: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
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
  { to: '/tts', label: 'Text to speech', short: 'Voice', icon: ICON.tts },
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
  { to: '/plans', label: 'Plans and billing', short: 'Plans', icon: ICON.billing },
  { to: '/account', label: 'Settings', icon: ICON.settings },
]

/** Everything the sidebar can reach, for the search box. */
export const NAV_ALL: NavItem[] = [...NAV_MAIN, ...NAV_BOTTOM]

/**
 * The five destinations the mobile tab bar shows: the four places there is
 * something to do, plus you. Billing is one tap away on the credits pill in the
 * phone's top bar, and Docs and Developers live in the drawer.
 */
export const NAV: NavItem[] = [...NAV_MAIN, { to: '/account', label: 'Settings', short: 'Me', icon: ICON.me }]

/** Breadcrumb titles, so the top bar names the page without each page telling it. */
export const PAGE_TITLES: Record<string, string> = {
  '/': 'Home',
  '/studio': 'Studio',
  '/works': 'My works',
  '/tts': 'Text to speech',
  '/plans': 'Plans and billing',
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
