import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'th-labs.theme'

// Read the theme the pre-hydration script already applied to <html>, so React
// state matches the DOM from the first render (no flash, no layout shift).
function currentTheme(): Theme {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'dark' || attr === 'light') return attr
  }
  return 'light'
}

/**
 * Theme state, persistence, and system-preference sync.
 * The initial value is set before paint by the inline script in index.html;
 * this hook only reflects and mutates it.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(currentTheme)

  const apply = useCallback((next: Theme) => {
    document.documentElement.setAttribute('data-theme', next)
    document.documentElement.style.colorScheme = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
    setThemeState(next)
  }, [])

  const toggle = useCallback(() => {
    apply(theme === 'dark' ? 'light' : 'dark')
  }, [theme, apply])

  // If the user has not made an explicit choice, follow the OS preference live.
  useEffect(() => {
    const stored = (() => {
      try {
        return localStorage.getItem(STORAGE_KEY)
      } catch {
        return null
      }
    })()
    if (stored === 'light' || stored === 'dark') return

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light')
      setThemeState(e.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return { theme, setTheme: apply, toggle }
}
