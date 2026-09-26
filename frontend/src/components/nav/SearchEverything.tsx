import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { NAV_ALL, RailSvg, type NavItem } from './nav-items'
import { useLanguages } from '../../lib/queries'

interface Hit {
  id: string
  label: string
  hint: string
  icon: React.ReactNode
  go: () => void
}

const MAX = 8

/**
 * Search across the app: every destination in the sidebar, plus the whole
 * language catalog — picking a language opens the Studio with it already set
 * as the target, which is the same handoff the dashboard's language grid uses.
 *
 * It searches only things this app can actually take you to. A box that offers
 * to search "everything" and then returns nothing for a real dub title would be
 * worse than not having one, so dubs are deliberately out of scope until the
 * library is searchable server-side.
 */
export default function SearchEverything() {
  const navigate = useNavigate()
  const { data: languages = [] } = useLanguages()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // ⌘K / Ctrl-K focuses the box from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const pages: NavItem[] = NAV_ALL

  const hits = useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return []

    const out: Hit[] = []

    for (const p of pages) {
      if (!p.label.toLowerCase().includes(needle)) continue
      out.push({
        id: `page:${p.label}`,
        label: p.label,
        hint: p.to,
        icon: <RailSvg icon={p.icon} className="h-4 w-4" />,
        go: () => navigate(p.to),
      })
    }

    for (const l of languages) {
      if (
        !l.name.toLowerCase().includes(needle) &&
        !l.native.toLowerCase().includes(needle) &&
        !l.code.toLowerCase().includes(needle)
      )
        continue
      out.push({
        id: `lang:${l.code}`,
        label: `Dub into ${l.name}`,
        hint: `${l.native} · ${l.code.toUpperCase()}`,
        icon: <span className="text-base leading-none">{l.flag}</span>,
        go: () => navigate('/studio', { state: { targetLang: l.code } }),
      })
    }

    return out.slice(0, MAX)
  }, [q, pages, languages, navigate])

  useEffect(() => setCursor(0), [q])

  function choose(hit: Hit | undefined) {
    if (!hit) return
    hit.go()
    setQ('')
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div ref={boxRef} className="relative">
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M11 4a7 7 0 1 0 4.95 11.95A7 7 0 0 0 11 4zM21 21l-4.35-4.35" />
      </svg>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setCursor((c) => Math.min(c + 1, hits.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setCursor((c) => Math.max(c - 1, 0))
          } else if (e.key === 'Enter') {
            choose(hits[cursor])
          }
        }}
        placeholder="Search everything…"
        aria-label="Search everything"
        className="focusable w-full rounded-full border border-subtle bg-surface py-2 pl-9 pr-16 text-sm text-primary outline-none transition-colors placeholder:text-muted hover:border-strong focus:border-strong"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[11px] text-muted"
      >
        <kbd className="rounded border border-subtle px-1.5 py-0.5">⌘</kbd>
        <kbd className="rounded border border-subtle px-1.5 py-0.5">K</kbd>
      </span>

      <AnimatePresence>
        {open && q.trim() && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-x-0 top-[calc(100%+0.4rem)] z-50 overflow-hidden rounded-xl border border-subtle bg-raised p-1.5 shadow-[var(--shadow-lg)]"
          >
            {hits.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted">
                Nothing matches “{q.trim()}”.
              </div>
            ) : (
              hits.map((hit, i) => (
                <button
                  key={hit.id}
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(hit)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    i === cursor ? 'bg-sunken' : ''
                  }`}
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center text-secondary">
                    {hit.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-primary">{hit.label}</span>
                  <span className="shrink-0 text-[11px] text-muted">{hit.hint}</span>
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
