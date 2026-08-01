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

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
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
      <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.14em] text-text-3">
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="focus-ring flex w-full items-center justify-between rounded-xl border border-line bg-white/[0.03] px-4 py-3 text-left text-sm transition-colors hover:border-line-strong"
      >
        <span className="flex items-center gap-2.5">
          <span className="text-base">{selected?.flag ?? '🌐'}</span>
          <span className="font-mono font-medium text-white">{selected?.name ?? 'Select…'}</span>
          {selected && 'native' in selected && (
            <span className="text-text-3">· {(selected as Language).native}</span>
          )}
        </span>
        <svg viewBox="0 0 24 24" className={`h-4 w-4 text-text-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="z-cards absolute mt-2 w-full overflow-hidden rounded-xl border border-line bg-surface-2/95 shadow-2xl backdrop-blur-xl">
          <div className="border-b border-line p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search languages…"
              className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-text-3"
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
              <div className="px-3 py-6 text-center text-sm text-text-3">
                No matches
              </div>
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
        active ? 'bg-accent-dim text-white' : 'text-text-2 hover:bg-white/5'
      }`}
    >
      <span className="text-base">{flag}</span>
      <span className="font-mono font-medium">{name}</span>
      <span className="ml-auto text-xs text-text-3">{native}</span>
    </button>
  )
}
