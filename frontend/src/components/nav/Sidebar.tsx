import { Link, useLocation } from 'react-router-dom'
import LogoMark from '../brand/LogoMark'
import { NAV_BOTTOM, NAV_MAIN, RailSvg, type NavItem } from './nav-items'
import { useWorkspace } from '../../lib/workspace'

/**
 * The labelled sidebar.
 *
 * It replaces the old 68px icon rail, and the difference is the point: a rail
 * of unlabelled glyphs makes you learn the product before you can navigate it,
 * where a named list tells you what is in here on first sight. Collapsing it
 * back to glyphs is the escape hatch for people who already know — the state
 * lives in the shell and is remembered across visits.
 *
 * It is a full-height column and it does not scroll with the page: the shell
 * gives the app a fixed viewport height and lets the content column scroll
 * inside it, so the nav stays put no matter how far down a page you are. Docs,
 * Developers, Plans and Settings sit against the bottom edge for the same
 * reason — a row whose position depends on how long the list above it is, is a
 * row you have to look for.
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

  // Same rule NavLink's `end` would apply, written out because the row needs
  // the verdict as a `data-` attribute (that is what `.side-link` styles on)
  // rather than as a class name.
  const isActive = (item: NavItem) =>
    item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`)

  const row = (item: NavItem) => (
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
        <RailSvg icon={item.icon} className="h-[18px] w-[18px]" />
        {item.soon && (
          <span aria-hidden className="absolute -right-1 -top-1 h-[5px] w-[5px] rounded-full bg-gold" />
        )}
      </span>
      {!compact && <span className="truncate">{item.label}</span>}
    </Link>
  )

  return (
    <aside
      className={`shrink-0 flex-col border-r border-subtle bg-surface ${
        compact ? 'w-[68px] px-3.5' : 'w-[248px] px-3'
      } py-4 ${className}`}
    >
      {/* Brand. The wordmark disappears when collapsed; the mark never does. */}
      <Link
        to="/"
        onClick={onNavigate}
        aria-label="TH-Labs home"
        className={`focusable mb-4 flex items-center gap-2 rounded-lg ${compact ? 'justify-center' : 'px-1.5'}`}
      >
        <LogoMark className="h-[22px] w-[22px] text-primary" title="TH-Labs" />
        {!compact && <span className="text-[15px] font-semibold tracking-tight text-primary">TH-Labs</span>}
      </Link>

      {/* The workspace card. There is one workspace per account, so it is an
          identity card and not a switcher — a chevron here would promise a menu
          with nothing to put in it. What it states is the account's staff role,
          or its billing tier when there is no staff role. */}
      {compact ? (
        <span
          aria-label={workspace.label}
          title={workspace.label}
          className="mx-auto mb-4 h-6 w-6 shrink-0 rounded-full"
          style={{ background: workspace.gradient }}
        />
      ) : (
        <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-subtle px-3 py-2.5">
          <span
            aria-hidden
            className="h-5 w-5 shrink-0 rounded-full"
            style={{ background: workspace.gradient }}
          />
          <span className="truncate text-sm font-medium text-primary">{workspace.label}</span>
        </div>
      )}

      <nav className="flex flex-col gap-0.5">{NAV_MAIN.map(row)}</nav>

      {/* `mt-auto` is what pins this group to the bottom edge of the column. */}
      <nav className="mt-auto flex flex-col gap-0.5 border-t border-subtle pt-3">
        {NAV_BOTTOM.map(row)}
      </nav>
    </aside>
  )
}
