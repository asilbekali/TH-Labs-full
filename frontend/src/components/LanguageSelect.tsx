import { useEffect, useMemo, useRef, useState } from 'react'
import type { Language } from '../lib/types'

export default function LanguageSelect({
  languages,
  value,
  onChange,
  allowAuto = false,
  label,
}: {
  languages: Language[]
  value: string
  onChange: (code: string) => void
  allowAuto?: boolean
  label: string
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
    if (value === 'auto') return { flag: '🌐', name: 'Auto-detect', code: 'auto' }
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

  return (
    <div ref={ref} className="relative">
      <label className="mb-1.5 block text-xs font-medium text-muted">{label}</label>
      <button
        type="button"
        disabled={loading}
        aria-busy={loading}
        onClick={() => !loading && setOpen((o) => !o)}
        className={`focusable flex w-full items-center justify-between rounded-2xl border border-subtle bg-sunken px-4 py-3 text-left text-sm transition-colors ${
          loading ? 'cursor-default' : 'hover:border-brand/50'
        }`}
      >
        {loading ? (
          <span className="flex items-center gap-2.5">
            <span className="shimmer h-4 w-4 shrink-0 rounded-full bg-strong/50" />
            <span className="shimmer h-3 w-24 rounded bg-strong/50" />
          </span>
        ) : (
          <span className="flex items-center gap-2.5">
            <span className="text-base">{selected?.flag ?? '🌐'}</span>
            <span className="font-medium text-primary">{selected?.name ?? 'Select…'}</span>
            {selected && 'native' in selected && (
              <span className="text-muted">· {(selected as Language).native}</span>
            )}
          </span>
        )}
        <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && !loading && (
        <div className="card absolute z-30 mt-2 w-full overflow-hidden p-0">
          <div className="border-b border-subtle p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search languages…"
              className="w-full rounded-lg bg-sunken px-3 py-2 text-sm text-primary outline-none placeholder:text-muted"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {allowAuto && (
              <Row
                flag="🌐"
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
            {filtered.map((l) => (
              <Row
                key={l.code}
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
  flag,
  name,
  native,
  active,
  onClick,
}: {
  flag: string
  name: string
  native: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        active ? 'bg-brand/12 text-primary' : 'text-secondary hover:bg-sunken'
      }`}
    >
      <span className="text-base">{flag}</span>
      <span className="font-medium">{name}</span>
      <span className="ml-auto text-xs text-muted">{native}</span>
    </button>
  )
}
