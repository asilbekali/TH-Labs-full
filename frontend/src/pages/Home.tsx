import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Page from '../components/Page'
import LogoMark from '../components/brand/LogoMark'
import { EASE_ENTRANCE, EASE_EXIT, rise, springLayout, stagger } from '../lib/motion'
import { getTemplates, getResumable, getHealth } from '../lib/api'
import type { Template, ResumableJob } from '../mocks/templates'
import { TEMPLATE_FILTERS, gradientFor } from '../mocks/templates'
import type { Health } from '../lib/types'
import { useAuth } from '../lib/auth'

const GALLERY_COLS = { gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' } as const

export default function Home() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [resumable, setResumable] = useState<ResumableJob[]>([])
  const [health, setHealth] = useState<Health | null>(null)

  const [filter, setFilter] = useState<string>('All')
  const [query, setQuery] = useState('')

  const loadTemplates = useCallback(() => {
    setFailed(false)
    setTemplates(null)
    getTemplates()
      .then(setTemplates)
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  useEffect(() => {
    getResumable().then(setResumable).catch(() => setResumable([]))
    getHealth().then(setHealth).catch(() => {})
  }, [])

  const firstName = user?.name?.trim().split(/\s+/)[0]
  // Health carries no explicit latency figure; fall back to the static string.
  const latency = health ? '~2s latency' : '~2s latency'

  const filtered = useMemo(() => {
    if (!templates) return []
    const q = query.trim().toLowerCase()
    return templates.filter((t) => {
      if (filter !== 'All' && t.category !== filter) return false
      if (!q) return true
      return t.title.toLowerCase().includes(q) || t.tags.some((tag) => tag.toLowerCase().includes(q))
    })
  }, [templates, filter, query])

  const openPreset = (preset: 'video' | 'podcast' | 'voice') => navigate('/studio', { state: { preset } })
  const openLangs = (sourceLang: string, targetLang: string) =>
    navigate('/studio', { state: { sourceLang, targetLang } })

  return (
    <Page className="space-y-6">
      {/* ── A · Hero strip (no card, ≤200px) ──────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE_ENTRANCE }}
        className="flex flex-wrap items-start justify-between gap-4"
      >
        <div className="min-w-0">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-brand">
            / 01 — Dashboard
          </span>
          <h1 className="mt-2 font-mono text-[1.9rem] font-medium leading-[1.15] tracking-tight text-primary sm:text-[2rem]">
            Welcome back
            {firstName ? (
              <>
                , <span className="gradient-text">{firstName}</span>
              </>
            ) : null}
          </h1>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-secondary">
            Dub any clip while keeping the original speaker's voice.
          </p>
        </div>
        <div className="flex shrink-0 gap-2.5">
          <HeroChip tint="brand" value="40+ languages" icon={ICON.globe} />
          <HeroChip tint="cyan" value={latency} icon={ICON.bolt} />
        </div>
      </motion.div>

      {/* ── B · Quick start ───────────────────────────────────────────────── */}
      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-6 md:grid-cols-3"
      >
        <QuickStartCard tint="brand" title="Dub a video" sub="From a file or link" icon={ICON.video} onClick={() => openPreset('video')} />
        <QuickStartCard tint="cyan" title="Dub a podcast" sub="Audio only" icon={ICON.mic} onClick={() => openPreset('podcast')} />
        <QuickStartCard tint="magenta" title="Clone a voice" sub="3s of audio" icon={ICON.userCheck} onClick={() => openPreset('voice')} />
      </motion.div>

      {/* ── C · Filter bar ────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE_ENTRANCE, delay: 0.12 }}
        className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="mr-1 hidden shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted sm:inline">
            / Templates
          </span>
          <div className="no-scrollbar flex snap-x gap-1.5 overflow-x-auto">
            {TEMPLATE_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="focusable relative shrink-0 snap-start rounded-full bg-sunken px-3.5 py-1.5 font-mono text-xs transition-colors"
              >
                {filter === f && (
                  <motion.span
                    layoutId="template-filter"
                    transition={springLayout}
                    className="absolute inset-0 rounded-full bg-surface shadow-sm"
                  />
                )}
                <span className={`relative z-10 ${filter === f ? 'font-medium text-primary' : 'text-secondary'}`}>{f}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="relative lg:w-60">
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d={ICON.search} />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates"
            className="focusable w-full rounded-full border border-subtle bg-sunken py-2 pl-9 pr-3 text-sm text-primary outline-none transition-colors placeholder:text-muted hover:border-brand/40"
          />
        </div>
      </motion.div>

      {/* ── D · Template gallery ──────────────────────────────────────────── */}
      {failed ? (
        <FailedCard onRetry={loadTemplates} />
      ) : !templates ? (
        <SkeletonGrid />
      ) : filtered.length === 0 ? (
        <EmptySearch query={query} onClear={() => { setQuery(''); setFilter('All') }} />
      ) : (
        <motion.div layout className="grid gap-6" style={GALLERY_COLS}>
          <AnimatePresence mode="popLayout">
            {filtered.map((t, i) => (
              <TemplateCard key={t.id} t={t} index={i} onClick={() => openLangs(t.sourceLang, t.targetLang)} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* ── E · Continue where you left off (conditional) ─────────────────── */}
      {resumable.length > 0 && (
        <div>
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">/ Continue where you left off</span>
          <div
            className="no-scrollbar mt-3 flex snap-x gap-4 overflow-x-auto pb-1"
            style={{
              WebkitMaskImage: 'linear-gradient(to right, black 0, black calc(100% - 40px), transparent 100%)',
              maskImage: 'linear-gradient(to right, black 0, black calc(100% - 40px), transparent 100%)',
            }}
          >
            {resumable.slice(0, 4).map((j, i) => (
              <motion.button
                key={j.id}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, ease: EASE_ENTRANCE, delay: i * 0.04 }}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => openLangs(j.sourceLang, j.targetLang)}
                className="card group focusable w-64 shrink-0 snap-start overflow-hidden p-0 text-left transition-shadow hover:shadow-[var(--shadow-lg)]"
              >
                <div className="relative aspect-video overflow-hidden">
                  <div className="thumb-grad absolute inset-0" style={{ backgroundImage: gradientFor(j.id) }} />
                  <span className="absolute bottom-2 left-2 rounded-full bg-black/40 px-2 py-0.5 font-mono text-[10px] text-white backdrop-blur-sm">
                    {Math.round(j.progress * 100)}%
                  </span>
                </div>
                <div className="p-3.5">
                  <div className="truncate font-mono text-sm font-medium text-primary">{j.title}</div>
                  <div className="mt-1 font-mono text-[11px] text-muted">
                    {langPair(j.sourceLang, j.targetLang)} · {j.stageLabel}
                  </div>
                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-sunken">
                    <div className="h-full rounded-full" style={{ width: `${j.progress * 100}%`, background: 'var(--grad-brand)' }} />
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      )}
    </Page>
  )
}

/* ── Blocks ─────────────────────────────────────────────────────────────── */

function TemplateCard({ t, index, onClick }: { t: Template; index: number; onClick: () => void }) {
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.15, ease: EASE_EXIT } }}
      transition={{ layout: springLayout, duration: 0.3, ease: EASE_ENTRANCE, delay: Math.min(index, 12) * 0.03 }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="card group focusable overflow-hidden p-0 text-left transition-shadow hover:shadow-[var(--shadow-lg)]"
    >
      <div className="relative aspect-video overflow-hidden">
        <div className="thumb-grad absolute inset-0" style={{ backgroundImage: gradientFor(t.id) }} />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/35 to-transparent" />
        <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-white/25 backdrop-blur-sm">
            <svg viewBox="0 0 24 24" className="h-5 w-5 translate-x-px text-white" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </span>
        <span className="absolute bottom-2 right-2 rounded-full bg-black/40 px-2 py-0.5 font-mono text-[10px] text-white backdrop-blur-sm">
          {fmtDur(t.duration)}
        </span>
      </div>
      <div className="p-4">
        <div className="truncate font-mono text-sm font-medium text-primary">{t.title}</div>
        <div className="mt-1 truncate font-mono text-[11px] text-muted">
          {langPair(t.sourceLang, t.targetLang)} · {fmtDur(t.duration)}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {t.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="rounded-full bg-sunken px-2 py-0.5 font-mono text-[10px] text-secondary">{tag}</span>
          ))}
        </div>
      </div>
    </motion.button>
  )
}

function QuickStartCard({
  tint,
  title,
  sub,
  icon,
  onClick,
}: {
  tint: 'brand' | 'cyan' | 'magenta'
  title: string
  sub: string
  icon: string
  onClick: () => void
}) {
  const tintClass = { brand: 'bg-brand/12 text-brand', cyan: 'bg-cyan/12 text-cyan', magenta: 'bg-magenta/12 text-magenta' }[tint]
  return (
    <motion.button
      variants={rise}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="card group focusable flex items-center gap-4 p-5 text-left transition-shadow hover:shadow-[var(--shadow-lg)] md:flex-col md:items-start md:gap-3"
    >
      <span className={`icon-tile h-12 w-12 shrink-0 ${tintClass}`}>
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d={icon} />
        </svg>
      </span>
      <span className="min-w-0 flex-1 md:flex-none">
        <span className="block font-mono text-[17px] font-medium text-primary">{title}</span>
        <span className="mt-0.5 block text-sm text-secondary">{sub}</span>
      </span>
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-[3px] md:mt-1 md:self-end" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={ICON.arrow} />
      </svg>
    </motion.button>
  )
}

function HeroChip({ tint, value, icon }: { tint: 'brand' | 'cyan'; value: string; icon: string }) {
  const tintClass = { brand: 'bg-brand/12 text-brand', cyan: 'bg-cyan/12 text-cyan' }[tint]
  return (
    <span className="chip inline-flex items-center gap-2 px-2.5 py-2">
      <span className={`icon-tile h-7 w-7 ${tintClass}`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d={icon} />
        </svg>
      </span>
      <span className="whitespace-nowrap font-mono text-xs font-medium text-primary">{value}</span>
    </span>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid gap-6" style={GALLERY_COLS}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card overflow-hidden p-0">
          <div className="shimmer aspect-video bg-sunken" />
          <div className="space-y-2.5 p-4">
            <div className="shimmer h-3.5 w-2/3 rounded bg-sunken" />
            <div className="shimmer h-3 w-1/2 rounded bg-sunken" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptySearch({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="relative grid min-h-[440px] place-items-center overflow-hidden rounded-[var(--radius-card)] border border-subtle bg-sunken/40 px-6 text-center">
      <LogoMark className="pointer-events-none absolute -bottom-12 -right-12 h-[220px] w-[220px] text-primary/[0.045]" />
      <div className="relative">
        <div className="font-mono text-lg font-medium text-primary">
          No templates match {query ? `"${query}"` : 'that filter'}
        </div>
        <p className="mx-auto mt-2 max-w-sm text-sm text-secondary">
          Try a different keyword or clear the filters to see the full gallery.
        </p>
        <button onClick={onClear} className="btn-ghost focusable mt-5 px-5 py-2.5 font-mono text-sm">
          Clear search
        </button>
      </div>
    </div>
  )
}

function FailedCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="card grid min-h-[240px] place-items-center p-8 text-center">
      <div>
        <span className="icon-tile mx-auto mb-3 grid h-11 w-11 bg-danger/12 text-danger">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8v5M12 16.5h.01M10.3 4.3 3.4 16a2 2 0 0 0 1.7 3h13.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
          </svg>
        </span>
        <div className="font-mono text-base font-medium text-primary">Couldn't load templates</div>
        <p className="mx-auto mt-1.5 max-w-xs text-sm text-secondary">Something went wrong fetching the gallery. Your other tools still work.</p>
        <button onClick={onRetry} className="btn-ghost focusable mt-4 px-5 py-2 font-mono text-sm">
          Retry
        </button>
      </div>
    </div>
  )
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function langPair(source: string, target: string): string {
  return `${source.toUpperCase()}→${target.toUpperCase()}`
}

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const ICON = {
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3.5 12h17M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18',
  bolt: 'M13 2 5 13h6l-1 9 8-11h-6z',
  video: 'M4 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM16 10l4-2v8l-4-2',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  userCheck: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3.5 20a5.5 5.5 0 0 1 11 0M16 12.5l2 2 4-4',
  search: 'M11 4a7 7 0 1 0 4.95 11.95A7 7 0 0 0 11 4zM21 21l-4.35-4.35',
  arrow: 'M5 12h14M13 6l6 6-6 6',
} as const
