import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import { NAV, RailSvg } from './nav-items'

/**
 * The bottom tab bar for < lg. Translucent surface with blur, an ink dot
 * sliding under the active tab, and the active icon scaling up.
 *
 * Renders every NAV entry, so it grows with the rail rather than drifting out of
 * step with it. An entry flagged `soon` gets the same dot the desktop rail uses.
 */
export default function MobileTabBar() {
  return (
    <nav className="glass fixed inset-x-0 bottom-0 z-40 flex items-center justify-around px-2 pb-[env(safe-area-inset-bottom)] pt-2 lg:hidden">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            `focusable relative flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 text-[10px] font-medium transition-colors ${
              isActive ? 'text-primary' : 'text-muted'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <motion.span
                animate={{ scale: isActive ? 1.1 : 1 }}
                transition={{ type: 'spring', stiffness: 380, damping: 24 }}
                className="relative"
              >
                <RailSvg icon={item.icon} className="h-[22px] w-[22px]" />
                {item.soon && !isActive && (
                  <span
                    aria-hidden
                    className="absolute -right-1 -top-0.5 h-[6px] w-[6px] rounded-full bg-gold"
                  />
                )}
              </motion.span>
              {item.label}
              {isActive && (
                <motion.span
                  layoutId="tab-dot"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  className="absolute -bottom-0.5 h-1 w-6 rounded-full bg-[rgb(var(--c-text-primary))]"
                />
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
