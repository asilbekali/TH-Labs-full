import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import { NAV, RailSvg } from './nav-items'

/**
 * The bottom tab bar for < lg: a floating capsule of liquid glass, held off the
 * screen edge and above the home indicator. The active tab is filled with ink,
 * and that fill slides between tabs.
 *
 * Renders every NAV entry, so it grows with the rail rather than drifting out of
 * step with it. An entry flagged `soon` gets the same dot the desktop rail uses.
 */
export default function MobileTabBar() {
  return (
    <nav
      aria-label="Primary"
      className="glass fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-40 mx-auto flex h-[70px] max-w-md items-center justify-around rounded-full px-2 lg:hidden"
    >
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            `focusable relative flex h-[54px] w-14 flex-col items-center justify-center gap-0.5 rounded-full text-[10px] font-medium transition-colors ${
              isActive ? 'text-[rgb(var(--c-canvas))]' : 'text-muted active:text-secondary'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId="tab-pill"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  className="absolute inset-0 rounded-full bg-[rgb(var(--c-text-primary))]"
                />
              )}
              <motion.span
                animate={{ scale: isActive ? 1.08 : 1, y: isActive ? -1 : 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 24 }}
                className="relative"
              >
                <RailSvg icon={item.icon} className="h-5 w-5" />
                {item.soon && !isActive && (
                  <span
                    aria-hidden
                    className="absolute -right-1 -top-0.5 h-[6px] w-[6px] rounded-full bg-brand"
                  />
                )}
              </motion.span>
              <span className="relative">{item.short ?? item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
