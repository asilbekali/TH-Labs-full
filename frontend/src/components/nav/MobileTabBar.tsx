import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import { NAV, RailSvg } from './nav-items'

/**
 * The bottom tab bar for < lg: a floating frosted pill, the landing's panel
 * shape, held off the screen edge and above the home indicator. The active tab
 * sits in a lit capsule that slides between tabs, its icon in orange.
 *
 * Renders every NAV entry, so it grows with the rail rather than drifting out of
 * step with it. An entry flagged `soon` gets the same dot the desktop rail uses.
 */
export default function MobileTabBar() {
  return (
    <nav
      aria-label="Primary"
      className="glass fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.625rem)] z-40 mx-auto flex max-w-md items-center justify-between rounded-full p-1.5 shadow-[var(--shadow-lg)] lg:hidden"
    >
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            `focusable relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[10.5px] font-medium transition-colors ${
              isActive ? 'text-primary' : 'text-muted active:text-secondary'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId="tab-pill"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  className="absolute inset-0 rounded-full bg-[var(--active-wash)] shadow-[inset_0_0_0_1px_var(--card-edge)]"
                />
              )}
              <motion.span
                animate={{ scale: isActive ? 1.08 : 1, y: isActive ? -1 : 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 24 }}
                className={`relative ${isActive ? 'text-brand' : ''}`}
              >
                <RailSvg icon={item.icon} className="h-[21px] w-[21px]" />
                {item.soon && !isActive && (
                  <span
                    aria-hidden
                    className="absolute -right-1 -top-0.5 h-[6px] w-[6px] rounded-full bg-gold"
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
