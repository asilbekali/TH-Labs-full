import { Link, useLocation } from 'react-router-dom'
import LogoMark from '../brand/LogoMark'
import AnimatedNumber from '../AnimatedNumber'
import { NAV_BOTTOM, NAV_MAIN, RailSvg, type NavItem } from './nav-items'
import { useWorkspace } from '../../lib/workspace'
import { useWorks } from '../../lib/works'
import { affordableSeconds, useWallet } from '../../lib/wallet'
import { useTheme } from '../../hooks/useTheme'

/**
 * The labelled sidebar.
 *
 * It replaces the old 68px icon rail, and the difference is the point: a rail
 * of unlabelled glyphs makes you learn the product before you can navigate it,
 * where a named list tells you what is in here on first sight. Collapsing it
 * back to glyphs is the escape hatch for people who already know — the state
 * lives in the shell and is remembered across visits.
 *
 * It is a full-height pane of glass and it does not scroll with the page: the shell
 * gives the app a fixed viewport height and lets the content column scroll
 * inside it, so the nav stays put no matter how far down a page you are. The
 * credits well, the Account group and the theme switch sit against the bottom
 * edge for the same reason — a row whose position depends on how long the
 * list above it is, is a row you have to look for.
 */
export default function Sidebar({
  compact,
  className = '',
  onNavigate,
}: {
  compact: boolean
  className?: string
  /** Called after any row is followed — the mobile drawer closes itself on it. */
  onNavigate?: () => void
}) {
  const { pathname } = useLocation()
  const workspace = useWorkspace()
  const { works } = useWorks()

  // Same rule NavLink's `end` would apply, written out because the row needs
  // the verdict as a `data-` attribute (that is what `.side-link` styles on)
  // rather than as a class name.
  const isActive = (item: NavItem) =>
    item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`)

  // A count beside My works, so the library's size is visible from anywhere.
  const badge = (item: NavItem) => {
    if (item.soon) return 'Soon'
    if (item.to === '/works' && works.length > 0) return works.length
    return null
  }

  const row = (item: NavItem) => {
    const b = badge(item)
    return (
      <Link
        key={item.to}
        to={item.to}
        title={compact ? item.label : undefined}
        onClick={onNavigate}
        data-active={isActive(item)}
        data-compact={compact}
        aria-current={isActive(item) ? 'page' : undefined}
        className="side-link focusable relative"
      >
        <span className="relative grid shrink-0 place-items-center">
          <RailSvg icon={item.icon} className="h-5 w-5" />
          {compact && item.soon && (
            <span aria-hidden className="absolute -right-1 -top-1 h-[5px] w-[5px] rounded-full bg-brand" />
          )}
        </span>
        {!compact && <span className="truncate">{item.label}</span>}
        {!compact && b !== null && <span className="side-badge num">{b}</span>}
      </Link>
    )
  }

  return (
    <aside
      className={`no-scrollbar shrink-0 flex-col gap-[18px] overflow-y-auto glass rounded-[30px] py-[18px] ${
        compact ? 'w-[76px] items-center px-3.5' : 'w-[264px] px-3.5'
      } ${className}`}
    >
      {/* Brand. The wordmark disappears when collapsed; the mark never does. */}
      <Link
        to="/"
        onClick={onNavigate}
        aria-label="TH-Labs home"
        className={`focusable flex items-center gap-2.5 rounded-xl ${compact ? 'justify-center' : 'px-1.5 py-0.5'}`}
      >
        <LogoMark className="h-[38px] w-[38px] shrink-0 text-primary" title="TH-Labs" />
        {!compact && <span className="text-lg font-semibold tracking-[-0.02em] text-primary">TH-Labs</span>}
      </Link>

      {/* The workspace card. There is one workspace per account, so it is an
          identity card and not a switcher — a chevron here would promise a menu
          with nothing to put in it. What it states is the account's staff role,
          or its billing tier when there is no staff role. */}
      {compact ? (
        <span
          aria-label={workspace.label}
          title={workspace.label}
          className="h-6 w-6 shrink-0 rounded-full"
          style={{ background: workspace.gradient }}
        />
      ) : (
        <div className="flex h-12 shrink-0 items-center gap-2.5 rounded-full border border-[var(--card-edge)] bg-[var(--well)] px-3">
          <span
            aria-hidden
            className="h-6 w-6 shrink-0 rounded-full"
            style={{ background: workspace.gradient }}
          />
          <span className="truncate text-sm font-medium text-primary">{workspace.label}</span>
        </div>
      )}

      <nav aria-label="Create" className="flex w-full flex-col gap-1">
        {!compact && <span className="side-group">Create</span>}
        {NAV_MAIN.map(row)}
      </nav>

      {/* `mt-auto` is what pins everything from here down to the bottom edge. */}
      <div className="mt-auto flex w-full flex-col gap-[18px]">
        {!compact && <CreditsWell onNavigate={onNavigate} />}

        <nav aria-label="Account" className="flex w-full flex-col gap-1">
          {!compact && <span className="side-group">Account</span>}
          {NAV_BOTTOM.map(row)}
        </nav>

        <ThemeSwitch compact={compact} />
      </div>
    </aside>
  )
}

/**
 * The balance, what it buys at the default quality, and the way to more. The
 * bar is the balance against the plan's monthly grant: copper for what is
 * left, cream for what has been spent, hatched past the grant.
 */
function CreditsWell({ onNavigate }: { onNavigate?: () => void }) {
  const { balance, planInfo, loading } = useWallet()
  const minutes = Math.floor(affordableSeconds(balance, 'balanced') / 60)
  const grant = Math.max(planInfo.creditsGranted, balance, 1)
  const left = Math.min(balance / grant, 1)

  return (
    <div className="inner flex flex-col gap-2.5 rounded-[22px] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted">Credits</span>
        <span className="chip px-2 py-0.5 text-[11px] text-primary">{planInfo.name}</span>
      </div>
      <AnimatedNumber value={balance} className={`num text-[30px] leading-8 text-primary ${loading ? 'opacity-40' : ''}`} />
      <div aria-hidden className="flex h-2 gap-[3px]">
        <span className="bar-ac rounded-full" style={{ flex: Math.max(left, 0.02) }} />
        <span className="bar-cream rounded-full" style={{ flex: Math.max(1 - left, 0) * 0.7 }} />
        <span className="hatch rounded-full" style={{ flex: 0.15 }} />
      </div>
      <span className="text-[13px] text-muted">
        About <span className="num">{minutes.toLocaleString()}</span> min at Balanced
      </span>
      <Link
        to="/plans"
        onClick={onNavigate}
        className="btn-primary focusable inline-flex h-[34px] w-full items-center justify-center text-[13px]"
      >
        Top up credits
      </Link>
    </div>
  )
}

/** Dark / Light, as a segmented switch rather than an icon you have to decode. */
function ThemeSwitch({ compact }: { compact: boolean }) {
  const { theme, setTheme, toggle } = useTheme()
  const moon = <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  const sun = (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  )

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        className="bar-icon focusable"
      >
        <RailSvg icon={theme === 'dark' ? moon : sun} className="h-4 w-4" />
      </button>
    )
  }

  return (
    <div role="radiogroup" aria-label="Theme" className="seg-track flex w-full">
      {(['dark', 'light'] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          data-active={theme === t}
          onClick={() => setTheme(t)}
          className="seg focusable flex-1"
        >
          <RailSvg icon={t === 'dark' ? moon : sun} className="h-4 w-4" />
          {t === 'dark' ? 'Dark' : 'Light'}
        </button>
      ))}
    </div>
  )
}
