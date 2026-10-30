import { useEffect, useMemo, useRef, useState } from 'react'
import type { Language } from '../lib/types'
import LangIcon from './LangIcon'

export default function LanguageSelect({
  languages,
  value,
  onChange,
  allowAuto = false,
  label,
  isLocked,
  lockedNote,
}: {
  languages: Language[]
  value: string
  onChange: (code: string) => void
  allowAuto?: boolean
  label: string
  /** A language the user's plan cannot pick. Listed (greyed, with a lock) after the open ones. */
  isLocked?: (code: string) => boolean
  /** One line above the locked part of the list, e.g. "Pro — every language". */
  lockedNote?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  // The list is empty only during the initial fetch — Studio falls back to a
  // bundled language list on failure, so an empty array here means "still
  // loading", never "unavailable". Show a skeleton trigger until it fills.
  const loading = languages.length === 0

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const selected = useMemo(() => {
    if (value === 'auto') return { flag: '', name: 'Auto-detect', code: 'auto' }
    return languages.find((l) => l.code === value)
  }, [value, languages])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return languages
    return languages.filter(
      (l) =>
        l.name.toLowerCase().includes(s) ||
        l.native.toLowerCase().includes(s) ||
        l.code.includes(s),
    )
  }, [q, languages])
  const available = isLocked ? filtered.filter((l) => !isLocked(l.code)) : filtered
  const locked = isLocked ? filtered.filter((l) => isLocked(l.code)) : []

  return (
    <div ref={ref} className="relative">
      <label className="mb-1.5 block text-xs font-medium text-muted">{label}</label>
      <button
        type="button"
        disabled={loading}
        aria-busy={loading}
        onClick={() => !loading && setOpen((o) => !o)}
        className={`focusable flex min-h-12 w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--well-edge)] bg-[var(--well)] px-3.5 py-2.5 text-left text-sm transition-[border-color,box-shadow] ${
          loading ? 'cursor-default' : 'hover:border-brand/50'
        } ${open ? 'border-brand/60 shadow-[0_0_0_3px_rgb(var(--c-brand-500)/0.16)]' : ''}`}
      >
        {loading ? (
          <span className="flex items-center gap-2.5">
            <span className="shimmer h-[22px] w-[22px] shrink-0 rounded-full bg-strong/50" />
            <span className="shimmer h-3 w-24 rounded bg-strong/50" />
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-2.5">
            <LangIcon code={value} flag={selected?.flag} size={22} />
            <span className="truncate font-medium text-primary">{selected?.name ?? 'Select…'}</span>
            {selected && 'native' in selected && (
              <span className="hidden truncate text-muted min-[380px]:inline">· {(selected as Language).native}</span>
            )}
          </span>
        )}
        <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && !loading && (
        // Solid, not the glass `.card`: this list floats over the next step,
        // and a translucent panel lets that step show through it.
        <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-[var(--radius-card)] border border-[var(--card-edge)] bg-raised shadow-[var(--shadow-lg),0_0_0_1px_rgb(0_0_0/0.2)]">
          <div className="border-b border-[var(--card-edge)] p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search languages…"
              className="field py-2"
            />
          </div>
          <div className="max-h-64 overflow-y-auto overscroll-contain p-1.5">
            {allowAuto && (
              <Row
                code="auto"
                name="Auto-detect"
                native="identify source language"
                active={value === 'auto'}
                onClick={() => {
                  onChange('auto')
                  setOpen(false)
                  setQ('')
                }}
              />
            )}
            {available.map((l) => (
              <Row
                key={l.code}
                code={l.code}
                flag={l.flag}
                name={l.name}
                native={l.native}
                active={value === l.code}
                onClick={() => {
                  onChange(l.code)
                  setOpen(false)
                  setQ('')
                }}
              />
            ))}
            {locked.length > 0 && (
              <div className="mt-1 border-t border-subtle px-3 pb-1 pt-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                {lockedNote ?? 'Upgrade to unlock'}
              </div>
            )}
            {locked.map((l) => (
              <Row
                key={l.code}
                code={l.code}
                flag={l.flag}
                name={l.name}
                native={l.native}
                active={false}
                locked
                onClick={() => {}}
              />
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({
  code,
  flag,
  name,
  native,
  active,
  onClick,
  locked = false,
}: {
  code: string
  flag?: string
  name: string
  native: string
  active: boolean
  onClick: () => void
  locked?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={locked}
      className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        locked
          ? 'cursor-not-allowed text-muted opacity-55'
          : active
            ? 'bg-brand/12 text-primary'
            : 'text-secondary hover:bg-sunken'
      }`}
    >
      <LangIcon code={code} flag={flag} size={20} className={locked ? 'grayscale' : ''} />
      <span className="font-medium">{name}</span>
      <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
        {native}
        {locked && (
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Locked">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        )}
      </span>
    </button>
  )
}
