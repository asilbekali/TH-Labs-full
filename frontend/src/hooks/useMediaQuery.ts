import { useEffect, useState } from 'react'

/**
 * Subscribe to a CSS media query and re-render on change.
 * SSR-safe (returns `false` until mounted). Used to switch the app between the
 * fixed-height desktop shell (§2) and the mobile scrolling document (§11).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return matches
}

// The lg breakpoint (1024px) is the line where the fixed shell engages.
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)')
}
