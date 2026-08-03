import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import { NAV, RailSvg } from './nav-items'

/**
 * The five-tab bottom bar for < lg (§11). Translucent surface with blur, a
 * gradient dot sliding under the active tab, and the active icon scaling up.
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
            `focusable relative flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 font-mono text-[10px] font-medium transition-colors ${
              isActive ? 'text-brand' : 'text-muted'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <motion.span animate={{ scale: isActive ? 1.1 : 1 }} transition={{ type: 'spring', stiffness: 380, damping: 24 }}>
                <RailSvg icon={item.icon} className="h-[22px] w-[22px]" />
              </motion.span>
              {item.label}
              {isActive && (
                <motion.span
                  layoutId="tab-dot"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  className="absolute -bottom-0.5 h-1 w-6 rounded-full"
                  style={{ background: 'var(--grad-brand)' }}
                />
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
