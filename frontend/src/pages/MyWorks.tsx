import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import Page from '../components/Page'
import ScrollColumn from '../components/layout/ScrollColumn'
import AnimatedNumber from '../components/AnimatedNumber'
import LogoMark from '../components/brand/LogoMark'
import { useIsDesktop, useMediaQuery } from '../hooks/useMediaQuery'
import { springLayout } from '../lib/motion'
import { getWorks } from '../lib/api'
import { gradientFor } from '../mocks/works'
import type { WorkItem, WorkStatus } from '../mocks/works'

type StatusFilter = 'all' | WorkStatus
type RangeFilter = 'any' | '7d' | '30d' | 'year'
type SortCol = 'title' | 'duration' | 'status' | 'date'

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'completed', label: 'Completed' },
  { key: 'processing', label: 'Running' },
  { key: 'failed', label: 'Failed' },
]

const RANGES: { key: RangeFilter; label: string }[] = [
  { key: 'any', label: 'Any time' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'year', label: 'This year' },
]

export default function MyWorks() {
  const isDesktop = useIsDesktop()
  const isMd = useMediaQuery('(min-width: 768px)')

  const [works, setWorks] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(true)

  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [pair, setPair] = useState('all')
  const [range, setRange] = useState<RangeFilter>('any')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ col: SortCol; dir: 'asc' | 'desc' }>({ col: 'date', dir: 'desc' })
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    getWorks()
      .then(setWorks)
      .catch(() => setWorks([]))
      .finally(() => setLoading(false))
  }, [])

  // The list table needs horizontal room; force grid below md and hide the toggle.
  const effView: 'grid' | 'list' = isMd ? view : 'grid'

  const pairs = useMemo(() => {
    const m = new Map<string, number>()
    for (const w of works) {
      const k = pairKey(w)
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [works])

  const filtered = useMemo(() => {
    const cutoff = rangeCutoff(range)
    const q = query.trim().toLowerCase()
    return works.filter(
      (w) =>
        (status === 'all' || w.status === status) &&
        (pair === 'all' || pairKey(w) === pair) &&
        (cutoff == null || new Date(w.createdAt).getTime() >= cutoff) &&
        (q === '' || w.title.toLowerCase().includes(q)),
    )
  }, [works, status, pair, range, query])

  // Grid keeps newest-first; the list respects the sortable column header.
  const items = useMemo(() => {
    if (effView !== 'list') return filtered
    return [...filtered].sort(makeSorter(sort))
  }, [filtered, effView, sort])

  const totalMinutes = useMemo(
    () => Math.round(filtered.reduce((a, w) => a + w.duration, 0) / 60),
    [filtered],
  )

  const selected = selectedId ? works.find((w) => w.id === selectedId) ?? null : null

  function clearFilters() {
    setStatus('all')
    setPair('all')
    setRange('any')
    setQuery('')
  }

  function toggleSort(col: SortCol) {
    setSort((s) => (s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'title' ? 'asc' : 'desc' }))
  }

  const header = (
    <Header
      count={filtered.length}
      minutes={totalMinutes}
      view={view}
      onView={setView}
      showToggle={isMd}
    />
  )

  const filterBar = (
    <FilterBar
      status={status}
      onStatus={setStatus}
      pair={pair}
      onPair={setPair}
      pairs={pairs}
      range={range}
      onRange={setRange}
      query={query}
      onQuery={setQuery}
    />
  )

  const results = (
    <Results
      loading={loading}
      total={works.length}
      items={items}
      view={effView}
      sort={sort}
      onSort={toggleSort}
      onOpen={setSelectedId}
      onClear={clearFilters}
    />
  )

  const drawer = (
    <AnimatePresence>
      {selected && (
        <DetailPanel
          key={selected.id}
          work={selected}
          isSheet={!isMd}
          onClose={() => setSelectedId(null)}
        />
      )}
    </AnimatePresence>
  )

  // Desktop: fixed header + filter rows over a scrolling results area (§ layout).
  if (isDesktop) {
    return (
      <Page className="h-full min-h-0">
        <div className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-4">
          {header}
          {filterBar}
          <ScrollColumn className="pr-0.5">{results}</ScrollColumn>
        </div>
        {drawer}
      </Page>
    )
  }

  // Mobile / tablet: a normal scrolling document.
  return (
    <Page className="space-y-4 pb-28">
      {header}
      {filterBar}
      {results}
      {drawer}
    </Page>
  )
}

/* ── Header ─────────────────────────────────────────────────────────────── */

function Header({
  count,
  minutes,
  view,
  onView,
  showToggle,
}: {
  count: number
  minutes: number
  view: 'grid' | 'list'
  onView: (v: 'grid' | 'list') => void
  showToggle: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-baseline gap-3">
        <h2 className="font-mono text-2xl font-medium text-primary">My works</h2>
        <span className="font-mono text-xs text-muted">
          <AnimatedNumber value={count} /> dubs · <AnimatedNumber value={minutes} /> min total
        </span>
      </div>
      {showToggle && (
        <LayoutGroup id="view-toggle">
          <div className="flex rounded-control border border-subtle bg-sunken p-1">
            {(['grid', 'list'] as const).map((v) => (
              <button
                key={v}
                onClick={() => onView(v)}
                aria-label={`${v} view`}
                aria-pressed={view === v}
                className="focusable relative grid h-8 w-9 place-items-center rounded-[10px]"
              >
                {view === v && (
                  <motion.span
                    layoutId="view-pill"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    className="absolute inset-0 rounded-[10px] bg-brand/15 shadow-[inset_0_0_0_1px_rgb(var(--c-brand-500)/0.4)]"
                  />
                )}
                <span className={`relative z-10 ${view === v ? 'text-brand' : 'text-muted'}`}>
                  {v === 'grid' ? <GridIcon /> : <ListIcon />}
                </span>
              </button>
            ))}
          </div>
        </LayoutGroup>
      )}
    </div>
  )
}

/* ── Filter bar ─────────────────────────────────────────────────────────── */

function FilterBar({
  status,
  onStatus,
  pair,
  onPair,
  pairs,
  range,
  onRange,
  query,
  onQuery,
}: {
  status: StatusFilter
  onStatus: (s: StatusFilter) => void
  pair: string
  onPair: (p: string) => void
  pairs: [string, number][]
  range: RangeFilter
  onRange: (r: RangeFilter) => void
  query: string
  onQuery: (q: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {/* Status pills */}
      <LayoutGroup id="status-pills">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 no-scrollbar">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.key}
              onClick={() => onStatus(s.key)}
              className={`focusable relative shrink-0 rounded-pill px-3.5 py-1.5 font-mono text-xs font-medium transition-colors ${
                status === s.key ? 'text-brand' : 'text-muted hover:text-secondary'
              }`}
            >
              {status === s.key && (
                <motion.span
                  layoutId="works-status"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  className="absolute inset-0 rounded-pill bg-brand/12 shadow-[inset_0_0_0_1px_rgb(var(--c-brand-500)/0.35)]"
                />
              )}
              <span className="relative z-10">{s.label}</span>
            </button>
          ))}
        </div>
      </LayoutGroup>

      <div className="flex flex-1 flex-wrap items-center gap-2.5">
        <MiniSelect
          value={pair}
          onChange={onPair}
          ariaLabel="Filter by language pair"
          options={[
            { value: 'all', label: 'All pairs' },
            ...pairs.map(([k, n]) => ({ value: k, label: `${k} (${n})` })),
          ]}
        />
        <MiniSelect
          value={range}
          onChange={(v) => onRange(v as RangeFilter)}
          ariaLabel="Filter by date"
          options={RANGES.map((r) => ({ value: r.key, label: r.label }))}
        />
        <div className="relative ml-auto min-w-[8rem] flex-1 sm:max-w-xs">
          <svg
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search titles"
            className="focusable w-full rounded-control border border-subtle bg-sunken py-2 pl-9 pr-3 text-sm text-primary placeholder:text-muted"
          />
        </div>
      </div>
    </div>
  )
}

function MiniSelect({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  ariaLabel: string
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className="focusable appearance-none rounded-control border border-subtle bg-sunken py-2 pl-3 pr-8 font-mono text-xs text-secondary"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  )
}

/* ── Results ────────────────────────────────────────────────────────────── */

function Results({
  loading,
  total,
  items,
  view,
  sort,
  onSort,
  onOpen,
  onClear,
}: {
  loading: boolean
  total: number
  items: WorkItem[]
  view: 'grid' | 'list'
  sort: { col: SortCol; dir: 'asc' | 'desc' }
  onSort: (c: SortCol) => void
  onOpen: (id: string) => void
  onClear: () => void
}) {
  if (loading) {
    return (
      <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card shimmer h-64 p-0" />
        ))}
      </div>
    )
  }

  if (total === 0) return <EmptyLibrary />
  if (items.length === 0) return <NoMatches onClear={onClear} />

  return (
    <LayoutGroup>
      {view === 'grid' ? (
        <motion.div
          layout
          className="grid gap-6 pb-1"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
        >
          <AnimatePresence mode="popLayout">
            {items.map((w) => (
              <GridCard key={w.id} work={w} onOpen={() => onOpen(w.id)} />
            ))}
          </AnimatePresence>
        </motion.div>
      ) : (
        <motion.div layout className="card overflow-hidden p-0">
          <ListHeaderRow sort={sort} onSort={onSort} />
          <AnimatePresence mode="popLayout">
            {items.map((w) => (
              <ListRow key={w.id} work={w} onOpen={() => onOpen(w.id)} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </LayoutGroup>
  )
}

/* ── Grid card ──────────────────────────────────────────────────────────── */

function GridCard({ work, onOpen }: { work: WorkItem; onOpen: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const failed = work.status === 'failed'
  const processing = work.status === 'processing'

  return (
    <motion.div
      layoutId={work.id}
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={springLayout}
      className="group card card-hover relative flex flex-col overflow-hidden p-0"
    >
      {/* Thumbnail */}
      <button
        onClick={onOpen}
        className="focusable relative block aspect-video w-full overflow-hidden text-left"
        aria-label={`Open ${work.title}`}
      >
        <span
          className={`thumb-grad absolute inset-0 ${failed ? 'grayscale' : ''}`}
          style={{ backgroundImage: gradientFor(work.id) }}
        />
        {processing ? (
          <div className="absolute inset-x-0 bottom-0">
            <div className="flex items-center justify-between px-3 pb-2 font-mono text-[11px] text-white/90">
              <span>{work.stage ?? 'Processing'}</span>
              <span>{Math.round((work.progress ?? 0) * 100)}%</span>
            </div>
            <div className="h-1 bg-black/30">
              <motion.div
                className="h-full"
                style={{ background: 'var(--grad-brand)' }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.round((work.progress ?? 0) * 100)}%` }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </div>
        ) : (
          <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <motion.span
              className="grid h-12 w-12 place-items-center rounded-full bg-black/35 backdrop-blur-sm"
              initial={{ scale: 0.9 }}
              whileHover={{ scale: 1 }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 translate-x-px text-white" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </motion.span>
          </span>
        )}
      </button>

      {/* Kebab */}
      <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Kebab open={menuOpen} onToggle={setMenuOpen} work={work} />
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 truncate font-mono text-sm font-medium text-primary">{work.title}</span>
          <StatusPill status={work.status} />
        </div>
        {failed ? (
          <div className="space-y-2">
            <p className="line-clamp-2 text-xs text-danger">{work.error}</p>
            <button className="btn-ghost focusable px-3 py-1.5 font-mono text-[11px]">Retry</button>
          </div>
        ) : (
          <span className="font-mono text-xs text-muted">
            {pairKey(work)} · {fmtDur(work.duration)} · {relTime(work.createdAt)}
          </span>
        )}
      </div>
    </motion.div>
  )
}

/* ── List rows ──────────────────────────────────────────────────────────── */

const LIST_COLS = 'grid-cols-[64px_minmax(0,1fr)_84px_84px_120px_110px_84px]'

function ListHeaderRow({ sort, onSort }: { sort: { col: SortCol; dir: 'asc' | 'desc' }; onSort: (c: SortCol) => void }) {
  const Cell = ({ col, label }: { col: SortCol; label: string }) => (
    <button
      onClick={() => onSort(col)}
      className="focusable flex items-center gap-1 text-left font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted hover:text-secondary"
    >
      {label}
      {sort.col === col && (
        <svg viewBox="0 0 24 24" className={`h-3 w-3 ${sort.dir === 'asc' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      )}
    </button>
  )
  return (
    <div className={`grid ${LIST_COLS} items-center gap-3 border-b border-subtle bg-sunken px-4 py-2.5`}>
      <span />
      <Cell col="title" label="Title" />
      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">Pair</span>
      <Cell col="duration" label="Length" />
      <Cell col="status" label="Status" />
      <Cell col="date" label="Date" />
      <span className="text-right font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">Actions</span>
    </div>
  )
}

function ListRow({ work, onOpen }: { work: WorkItem; onOpen: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <motion.div
      layoutId={work.id}
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={springLayout}
      className={`group grid ${LIST_COLS} items-center gap-3 border-b border-subtle px-4 py-3 transition-colors last:border-0 hover:bg-sunken`}
    >
      <button onClick={onOpen} className="focusable h-9 w-16 overflow-hidden rounded-lg" aria-label={`Open ${work.title}`}>
        <span className={`thumb-grad block h-full w-full ${work.status === 'failed' ? 'grayscale' : ''}`} style={{ backgroundImage: gradientFor(work.id) }} />
      </button>
      <button onClick={onOpen} className="min-w-0 text-left">
        <div className="truncate font-mono text-sm font-medium text-primary">{work.title}</div>
        <div className="truncate text-xs text-muted">{work.sourceFile}</div>
      </button>
      <span className="font-mono text-xs text-secondary">{pairKey(work)}</span>
      <span className="font-mono text-xs text-secondary">{fmtDur(work.duration)}</span>
      <StatusPill status={work.status} />
      <div className="font-mono text-xs leading-tight text-secondary">
        <div>{fmtDate(work.createdAt)}</div>
        <div className="text-muted">{fmtTime(work.createdAt)}</div>
      </div>
      <div className="flex items-center justify-end gap-1">
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          aria-label="Download"
          className="focusable grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-surface hover:text-primary"
        >
          <DownloadIcon />
        </a>
        <Kebab open={menuOpen} onToggle={setMenuOpen} work={work} align="right" />
      </div>
    </motion.div>
  )
}

/* ── Kebab menu ─────────────────────────────────────────────────────────── */

function Kebab({
  open,
  onToggle,
  work,
  align = 'right',
}: {
  open: boolean
  onToggle: (v: boolean) => void
  work: WorkItem
  align?: 'left' | 'right'
}) {
  const navigate = useNavigate()
  const items = [
    { label: 'Download', onClick: () => {} },
    { label: 'Rename', onClick: () => {} },
    { label: 'Duplicate settings', onClick: () => navigate('/studio', { state: duplicateState(work) }) },
    { label: 'Delete', onClick: () => {}, danger: true },
  ]
  return (
    <div className="relative">
      <button
        onClick={() => onToggle(!open)}
        aria-label="More actions"
        aria-expanded={open}
        className="focusable grid h-8 w-8 place-items-center rounded-full bg-surface/80 text-secondary backdrop-blur-sm hover:text-primary"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <>
            <button className="fixed inset-0 z-40 cursor-default" aria-hidden onClick={() => onToggle(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -4 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              style={{ transformOrigin: align === 'right' ? 'top right' : 'top left' }}
              className={`absolute z-50 mt-1 w-44 overflow-hidden rounded-control border border-subtle bg-raised py-1 shadow-[var(--shadow-lg)] ${
                align === 'right' ? 'right-0' : 'left-0'
              }`}
            >
              {items.map((it) => (
                <button
                  key={it.label}
                  onClick={() => {
                    it.onClick()
                    onToggle(false)
                  }}
                  className={`block w-full px-3.5 py-2 text-left text-sm transition-colors hover:bg-sunken ${
                    it.danger ? 'text-danger' : 'text-secondary hover:text-primary'
                  }`}
                >
                  {it.label}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Detail drawer / bottom sheet ───────────────────────────────────────── */

function DetailPanel({ work, isSheet, onClose }: { work: WorkItem; isSheet: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [side, setSide] = useState<'source' | 'dubbed'>('dubbed')
  const [playT, setPlayT] = useState(0)
  const [playing, setPlaying] = useState(false)

  // Escape closes; lock the document behind the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  // Simulated transcript playhead (no real media in the mock).
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      setPlayT((t) => {
        const next = t + 0.25
        if (next >= work.duration) {
          setPlaying(false)
          return 0
        }
        return next
      })
    }, 250)
    return () => window.clearInterval(id)
  }, [playing, work.duration])

  const activeLine = TRANSCRIPT.reduce((acc, l, i) => (l.t <= playT ? i : acc), 0)

  const panelMotion = isSheet
    ? {
        initial: { y: '100%' },
        animate: { y: 0 },
        exit: { y: '100%' },
        drag: 'y' as const,
        dragConstraints: { top: 0, bottom: 0 },
        dragElastic: { top: 0.05, bottom: 0.4 },
        onDragEnd: (_e: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
          if (info.offset.y > 140 || info.velocity.y > 700) onClose()
        },
      }
    : { initial: { x: '100%' }, animate: { x: 0 }, exit: { x: '100%' } }

  return (
    <div className="fixed inset-0 z-[60]">
      <motion.div
        className="absolute inset-0 bg-black/45"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        {...panelMotion}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        className={
          isSheet
            ? 'absolute inset-x-0 bottom-0 flex max-h-[90vh] min-h-[50vh] flex-col rounded-t-[var(--radius-card)] border-t border-subtle bg-raised'
            : 'absolute right-0 top-0 flex h-full w-[480px] max-w-full flex-col rounded-l-[var(--radius-card)] border-l border-subtle bg-raised shadow-[var(--shadow-lg)]'
        }
      >
        {isSheet && (
          <div className="grid place-items-center pt-2.5">
            <span className="h-1.5 w-10 rounded-full bg-strong" />
          </div>
        )}
        {/* Title row */}
        <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-4">
          <div className="min-w-0">
            <h3 className="truncate font-mono text-lg font-medium text-primary">{work.title}</h3>
            <p className="mt-0.5 truncate font-mono text-xs text-muted">
              {work.sourceFile} · {pairKey(work)} · {fmtDur(work.duration)}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="focusable grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted hover:bg-sunken hover:text-primary">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pb-6 no-scrollbar">
          {/* A/B player */}
          <div className="overflow-hidden rounded-control border border-subtle">
            <div className="flex items-center justify-between border-b border-subtle bg-sunken px-3 py-2">
              <LayoutGroup id={`ab-${work.id}`}>
                <div className="flex gap-1">
                  {(['source', 'dubbed'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSide(s)}
                      className={`focusable relative rounded-pill px-3 py-1 font-mono text-[11px] ${side === s ? 'text-brand' : 'text-muted'}`}
                    >
                      {side === s && <motion.span layoutId="ab-pill" className="absolute inset-0 rounded-pill bg-brand/15" />}
                      <span className="relative z-10">{s === 'source' ? 'Original' : 'Dubbed'}</span>
                    </button>
                  ))}
                </div>
              </LayoutGroup>
              <button
                onClick={() => setPlaying((p) => !p)}
                className="focusable grid h-7 w-7 place-items-center rounded-full bg-brand text-white"
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor"><path d="M7 5h3v14H7zM14 5h3v14h-3z" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 translate-x-px" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                )}
              </button>
            </div>
            <div className="relative aspect-video">
              <span
                className={`absolute inset-0 ${side === 'source' ? 'grayscale' : ''}`}
                style={{ backgroundImage: gradientFor(work.id + side), backgroundSize: 'cover' }}
              />
              <span className="absolute bottom-2 left-3 font-mono text-[11px] text-white/90">
                {fmtDur(Math.floor(playT))} / {fmtDur(work.duration)}
              </span>
            </div>
          </div>

          {/* Transcript */}
          <Section label="Transcript">
            <div className="space-y-1">
              {TRANSCRIPT.map((l, i) => {
                const active = i === activeLine && playing
                return (
                  <div key={i} className={`relative rounded-lg py-1.5 pl-3 pr-2 transition-colors ${active ? 'bg-brand/[0.07]' : ''}`}>
                    <motion.span
                      className="absolute left-0 top-1.5 w-[3px] rounded-full bg-brand"
                      initial={false}
                      animate={{ height: active ? '80%' : '0%', opacity: active ? 1 : 0 }}
                      transition={{ duration: 0.3 }}
                    />
                    <span className="mr-2 font-mono text-[10px] text-muted">{fmtDur(l.t)}</span>
                    <span className={`text-sm ${active ? 'text-primary' : 'text-secondary'}`}>{l.source}</span>
                    <div className="mt-0.5 pl-8 font-mono text-xs text-muted">{l.target}</div>
                  </div>
                )
              })}
            </div>
          </Section>

          {/* Settings used */}
          <Section label="Settings used">
            <dl className="divide-y divide-subtle">
              <SettingRow k="Languages" v={`${work.sourceLang.toUpperCase()} → ${work.targetLang.toUpperCase()}`} />
              <SettingRow k="Voice cloning" v={work.settings.voiceClone ? 'On' : 'Off'} />
              <SettingRow k="Lip sync" v={work.settings.lipSync ? 'On' : 'Off'} />
              <SettingRow k="Background & effects" v={work.settings.keepBackground ? 'Kept' : 'Replaced'} />
              <SettingRow k="Quality" v={cap(work.settings.quality)} />
            </dl>
          </Section>

          {/* Cost */}
          <Section label="Cost">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-3xl font-medium text-primary">{work.creditsSpent}</span>
              <span className="font-mono text-xs text-muted">credits spent</span>
            </div>
          </Section>
        </div>

        {/* Footer CTA */}
        <div className="border-t border-subtle p-4">
          <button
            onClick={() => navigate('/studio', { state: duplicateState(work) })}
            className="btn-primary focusable w-full py-3 font-mono text-sm"
          >
            Duplicate these settings →
          </button>
        </div>
      </motion.aside>
    </div>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">/ {label}</div>
      {children}
    </div>
  )
}

function SettingRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-secondary">{k}</span>
      <span className="font-mono text-primary">{v}</span>
    </div>
  )
}

/* ── Empty states ───────────────────────────────────────────────────────── */

function EmptyLibrary() {
  const navigate = useNavigate()
  return (
    <div className="card relative grid min-h-[340px] place-items-center overflow-hidden p-8 text-center">
      <LogoMark className="pointer-events-none absolute -bottom-12 -right-12 h-[220px] w-[220px] text-primary/[0.05]" />
      <div className="relative">
        <h3 className="font-mono text-lg font-medium text-primary">No dubs yet</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-secondary">Your finished dubs will collect here.</p>
        <button onClick={() => navigate('/studio')} className="btn-primary focusable mt-6 px-5 py-2.5 font-mono text-sm">
          Go to studio →
        </button>
      </div>
    </div>
  )
}

function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <div className="card grid min-h-[280px] place-items-center p-8 text-center">
      <div>
        <h3 className="font-mono text-lg font-medium text-primary">No dubs match these filters</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-secondary">Try widening the date range or clearing the search.</p>
        <button onClick={onClear} className="btn-ghost focusable mt-6 px-5 py-2.5 font-mono text-sm">
          Clear filters
        </button>
      </div>
    </div>
  )
}

/* ── Small pieces ───────────────────────────────────────────────────────── */

function StatusPill({ status }: { status: WorkStatus }) {
  const style = {
    completed: 'bg-success/12 text-success',
    processing: 'bg-info/12 text-info',
    failed: 'bg-danger/12 text-danger',
  }[status]
  const label = { completed: 'Completed', processing: 'Running', failed: 'Failed' }[status]
  return (
    <span className={`inline-flex w-fit shrink-0 items-center gap-1 justify-self-start rounded-pill px-2 py-0.5 font-mono text-[10px] font-medium ${style}`}>
      {status === 'processing' && <span className="h-1.5 w-1.5 animate-soft-pulse rounded-full bg-info" />}
      {label}
    </span>
  )
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
    </svg>
  )
}

/* ── Transcript sample (illustrative — the mock carries no real media) ──── */
const TRANSCRIPT: { t: number; source: string; target: string }[] = [
  { t: 0, source: 'Welcome back to the channel.', target: 'Bienvenidos de nuevo al canal.' },
  { t: 4, source: 'Today we are looking at something new.', target: 'Hoy veremos algo nuevo.' },
  { t: 9, source: 'It only takes a couple of minutes to set up.', target: 'Solo toma un par de minutos configurarlo.' },
  { t: 15, source: 'Let me show you how it works.', target: 'Déjame mostrarte cómo funciona.' },
  { t: 21, source: 'Thanks for watching — see you next time.', target: 'Gracias por ver, hasta la próxima.' },
]

/* ── Pure helpers ───────────────────────────────────────────────────────── */

function pairKey(w: WorkItem): string {
  return `${w.sourceLang.toUpperCase()}→${w.targetLang.toUpperCase()}`
}

function rangeCutoff(range: RangeFilter): number | null {
  const now = Date.now()
  if (range === '7d') return now - 7 * 86_400_000
  if (range === '30d') return now - 30 * 86_400_000
  if (range === 'year') return new Date(new Date().getFullYear(), 0, 1).getTime()
  return null
}

const STATUS_ORDER: Record<WorkStatus, number> = { processing: 0, completed: 1, failed: 2 }

function makeSorter(sort: { col: SortCol; dir: 'asc' | 'desc' }) {
  const dir = sort.dir === 'asc' ? 1 : -1
  return (a: WorkItem, b: WorkItem): number => {
    let d = 0
    switch (sort.col) {
      case 'title':
        d = a.title.localeCompare(b.title)
        break
      case 'duration':
        d = a.duration - b.duration
        break
      case 'status':
        d = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        break
      case 'date':
        d = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        break
    }
    return d * dir
  }
}

function duplicateState(w: WorkItem) {
  return {
    sourceLang: w.sourceLang,
    targetLang: w.targetLang,
    voiceClone: w.settings.voiceClone,
    lipSync: w.settings.lipSync,
    keepBackground: w.settings.keepBackground,
    quality: w.settings.quality,
  }
}

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const day = 86_400_000
  const days = Math.floor(diff / day)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'} ago`
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
