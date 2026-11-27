import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { Language } from '../lib/messages'
import { CheckIcon, ChevronIcon, GlobeIcon, SearchIcon } from './icons'
import { useStored } from './useStored'

const RECENT_KEY = 'recentLanguages'
const RECENT_MAX = 3

interface Props {
  value: string
  languages: Language[]
  disabled?: boolean
  onChange: (code: string) => void
}

/**
 * A searchable language list that opens in place (no floating menu: the popup
 * clips anything that overflows it). Recently used languages come first.
 */
export function LanguagePicker({ value, languages, disabled, onChange }: Props) {
  const recent = useStored<string[]>('local', RECENT_KEY) ?? []
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const current = languages.find((l) => l.code === value)

  const options = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q) return languages.filter((l) => l.name.toLowerCase().includes(q) || l.code === q)
    const top = recent.map((c) => languages.find((l) => l.code === c)).filter((l): l is Language => !!l)
    return [...top, ...languages.filter((l) => !recent.includes(l.code))]
  }, [languages, query, recent])
  const recentCount = query ? 0 : recent.filter((c) => languages.some((l) => l.code === c)).length

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function show() {
    setQuery('')
    setActive(Math.max(0, options.findIndex((l) => l.code === value)))
    setOpen(true)
  }

  function pick(code: string) {
    onChange(code)
    void chrome.storage.local.set({ [RECENT_KEY]: [code, ...recent.filter((c) => c !== code)].slice(0, RECENT_MAX) })
    setOpen(false)
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') setActive((i) => Math.min(options.length - 1, i + 1))
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1))
    else if (e.key === 'Enter' && options[active]) pick(options[active].code)
    else if (e.key === 'Escape') setOpen(false)
    else return
    e.preventDefault()
  }

  if (!open) {
    return (
      <button type="button" className="picker-trigger" disabled={disabled} onClick={show} aria-haspopup="listbox">
        <GlobeIcon />
        <span className="picker-value">{current?.name ?? value}</span>
        <ChevronIcon />
      </button>
    )
  }

  return (
    <div className="picker" ref={root}>
      <div className="picker-search">
        <SearchIcon />
        <input
          type="text"
          autoFocus
          placeholder="Search languages"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded
          aria-controls="language-list"
        />
      </div>
      <ul className="picker-list" id="language-list" role="listbox" ref={list}>
        {options.length === 0 && <li className="picker-empty">No language matches "{query}"</li>}
        {options.map((l, i) => (
          <li key={l.code}>
            {i === 0 && recentCount > 0 && <div className="picker-group">Recent</div>}
            {i === recentCount && recentCount > 0 && <div className="picker-group">All languages</div>}
            <button
              type="button"
              role="option"
              aria-selected={l.code === value}
              data-index={i}
              className={`picker-option ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(l.code)}
            >
              <span>{l.name}</span>
              {l.code === value && <CheckIcon />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
