import { useCallback, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'th-labs.theme'

// Read the theme the pre-hydration script already applied to <html>, so React
// state matches the DOM from the first render (no flash, no layout shift).
function currentTheme(): Theme {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'dark' || attr === 'light') return attr
  }
  return 'dark'
}

/**
 * Theme state and persistence.
 * The initial value is set before paint by the inline script in index.html;
 * this hook only reflects and mutates it. Dark is the default rather than the
 * OS preference: it is the landing site's only mode, so the panel matches the
 * page people arrive from until they choose otherwise.
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

  return { theme, setTheme: apply, toggle }
}
