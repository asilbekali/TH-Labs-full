import { useEffect, useId, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from 'framer-motion'
import LogoMark from '../brand/LogoMark'
import AnimatedNumber from '../AnimatedNumber'
import { NAV_BOTTOM, NAV_MAIN, NAV_TOOLS, RailSvg, TOOLS_ICON, type NavItem } from './nav-items'
import { useWorkspace } from '../../lib/workspace'
import { useWorks } from '../../lib/works'
import { affordableSeconds, useWallet } from '../../lib/wallet'
import { useTheme } from '../../hooks/useTheme'
import { PLAN_LABEL, TOOL_PLAN, usePlan } from '../../lib/plan'
import { EASE_ENTRANCE, springLayout } from '../../lib/motion'

// Labels and other expanded-only pieces fade and slide in as the pane widens.
const reveal = {
  initial: { opacity: 0, x: -6 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.25, ease: EASE_ENTRANCE, delay: 0.08 } },
  exit: { opacity: 0, x: -6, transition: { duration: 0.12 } },
}

// Rows rise in one after another the first time the pane mounts.
const list = { hidden: {}, show: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } } }
const item = {
  hidden: { opacity: 0, x: -10 },
  show: { opacity: 1, x: 0, transition: { duration: 0.35, ease: EASE_ENTRANCE } },
}

/** The ink fill behind the current row. Every row renders it while active and
 *  framer-motion glides it between them via the shared layoutId. */
function ActivePill() {
  return <motion.span layoutId="side-active" className="side-pill" transition={springLayout} />
}

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
  const plan = usePlan()
  // The desktop pane stays mounted (just hidden) while the mobile drawer is
  // open, so each instance needs its own layout group or the pills collide.
  const group = useId()

  // Same rule NavLink's `end` would apply, written out because the row needs
  // the verdict as a `data-` attribute (that is what `.side-link` styles on)
  // rather than as a class name.
  const isActive = (item: NavItem) =>
    item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`)

  // The Tools group: open while you are in one of its tools, and otherwise
  // whatever you last left it as.
  const inTools = NAV_TOOLS.some(isActive)
  const [toolsOpen, setToolsOpen] = useState(inTools)
  useEffect(() => {
    if (inTools) setToolsOpen(true)
  }, [inTools])

  // A count beside My works, so the library's size is visible from anywhere.
  const badge = (item: NavItem) => {
    if (item.soon) return 'Soon'
    // A tool this plan does not include: say which plan does.
    if (item.tool && !plan.loading && !plan.has(item.tool)) return PLAN_LABEL[TOOL_PLAN[item.tool]]
    if (item.to === '/works' && works.length > 0) return works.length
    return null
  }

  const row = (it: NavItem) => {
    const b = badge(it)
    const active = isActive(it)
    return (
      <motion.div key={it.to} variants={item} className="w-full">
        <Link
          to={it.to}
          title={compact ? it.label : undefined}
          onClick={onNavigate}
          data-active={isActive(it)}
          data-compact={compact}
          aria-current={isActive(it) ? 'page' : undefined}
          className="side-link focusable relative"
        >
          {active && <ActivePill />}
          <span className="relative grid shrink-0 place-items-center">
            <RailSvg icon={it.icon} className="h-5 w-5" />
            {compact && it.soon && (
              <span aria-hidden className="absolute -right-1 -top-1 h-[5px] w-[5px] rounded-full bg-brand" />
            )}
          </span>
          <AnimatePresence initial={false}>
            {!compact && (
              <motion.span key="label" {...reveal} className="truncate">
                {it.label}
              </motion.span>
            )}
            {!compact && b !== null && (
              <motion.span key="badge" {...reveal} className="side-badge num">
                {b}
              </motion.span>
            )}
          </AnimatePresence>
        </Link>
      </motion.div>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup id={group}>
        <motion.aside
          initial={false}
          animate={{ width: compact ? 76 : 264 }}
          transition={springLayout}
          className={`no-scrollbar shrink-0 flex-col gap-[18px] overflow-y-auto overflow-x-hidden glass rounded-[30px] px-3.5 py-[18px] ${
            compact ? 'items-center' : ''
          } ${className}`}
        >
          {/* Brand. The wordmark disappears when collapsed; the mark never does. */}
          <Link
            to="/"
            onClick={onNavigate}
            aria-label="TH-Labs home"
            className={`focusable flex items-center gap-2.5 rounded-xl ${compact ? 'justify-center' : 'px-1.5 py-0.5'}`}
          >
            <motion.span
              className="shrink-0"
              initial={{ rotate: -90, scale: 0.6, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              whileHover={{ rotate: 8, scale: 1.06 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            >
              <LogoMark className="h-[38px] w-[38px] text-primary" title="TH-Labs" />
            </motion.span>
            <AnimatePresence initial={false}>
              {!compact && (
                <motion.span
                  key="wordmark"
                  {...reveal}
                  className="whitespace-nowrap text-lg font-semibold tracking-[-0.02em] text-primary"
                >
                  TH-Labs
                </motion.span>
              )}
            </AnimatePresence>
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

          <motion.nav
            aria-label="Create"
            className="flex w-full flex-col gap-1"
            variants={list}
            initial="hidden"
            animate="show"
          >
            {!compact && <span className="side-group">Create</span>}
            {NAV_MAIN.map(row)}
            {compact ? (
              // Collapsed to icons there is no label to open; show the tools.
              NAV_TOOLS.map(row)
            ) : (
              <motion.div variants={item} className="w-full">
                <button
                  type="button"
                  onClick={() => setToolsOpen((o) => !o)}
                  aria-expanded={toolsOpen}
                  aria-controls={`${group}-tools`}
                  data-active={false}
                  className={`side-link focusable relative w-full ${inTools && !toolsOpen ? 'text-primary' : ''}`}
                >
                  <span className="relative grid shrink-0 place-items-center">
                    <RailSvg icon={TOOLS_ICON} className="h-5 w-5" />
                  </span>
                  <span className="truncate">Tools</span>
                  <motion.svg
                    viewBox="0 0 24 24"
                    className="ml-auto h-4 w-4 shrink-0 text-muted"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    animate={{ rotate: toolsOpen ? 90 : 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                    aria-hidden
                  >
                    <path d="m9 6 6 6-6 6" />
                  </motion.svg>
                </button>
                <AnimatePresence initial={false}>
                  {toolsOpen && (
                    <motion.div
                      id={`${group}-tools`}
                      key="tools"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: EASE_ENTRANCE }}
                      className="ml-4 overflow-hidden border-l border-[var(--card-edge)] pl-2 pt-1"
                    >
                      {/* Its own stagger: rows take their entrance from a
                          variants parent, and this panel animates height. */}
                      <motion.div variants={list} initial="hidden" animate="show" className="flex flex-col gap-1">
                        {NAV_TOOLS.map(row)}
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </motion.nav>

          {/* `mt-auto` is what pins everything from here down to the bottom edge. */}
          <div className="mt-auto flex w-full flex-col gap-[18px]">
            <AnimatePresence initial={false}>
              {!compact && (
                <motion.div
                  key="credits"
                  initial={{ opacity: 0, y: 8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.3, ease: EASE_ENTRANCE, delay: 0.1 } }}
                  exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
                >
                  <CreditsWell onNavigate={onNavigate} />
                </motion.div>
              )}
            </AnimatePresence>

            <motion.nav
              aria-label="Account"
              className="flex w-full flex-col gap-1"
              variants={list}
              initial="hidden"
              animate="show"
            >
              {!compact && <span className="side-group">Account</span>}
              {NAV_BOTTOM.map(row)}
            </motion.nav>

            <ThemeSwitch compact={compact} />
          </div>
        </motion.aside>
      </LayoutGroup>
    </MotionConfig>
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
        <span className="text-[13px] text-muted">Tokens</span>
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
        Top up tokens
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
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={theme}
            className="grid place-items-center"
            initial={{ rotate: -90, scale: 0.5, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: 90, scale: 0.5, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_ENTRANCE }}
          >
            <RailSvg icon={theme === 'dark' ? moon : sun} className="h-4 w-4" />
          </motion.span>
        </AnimatePresence>
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
          className="seg seg-glide focusable flex-1"
        >
          {theme === t && (
            <motion.span layoutId="theme-active" className="side-pill" transition={springLayout} />
          )}
          <RailSvg icon={t === 'dark' ? moon : sun} className="h-4 w-4" />
          <span>{t === 'dark' ? 'Dark' : 'Light'}</span>
        </button>
      ))}
    </div>
  )
}
