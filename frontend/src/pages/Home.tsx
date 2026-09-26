// Dashboard (01).
//
// The page opens the way a tool should: with the thing you came to do, already
// on screen. The composer is the first card — paste a link or pick an upload,
// choose a target language, go — and everything under it is context, in the
// order you actually need it: what is running now, what you can dub into, is
// the pipeline up, what you made last.
//
// Everything here is live. The language grid is GET /v1/languages, the pipeline
// strip is GET /v1/health, the activity rows are the account's own dubs, and
// the feedback box is POST /v1/feedback (it lands in the admin panel's inbox —
// see docs/ADMIN_PANEL_BRIEF.md §4.6). Nothing on this page is a placeholder.
//
// The composer LAUNCHES a dub, it does not run one. Uploads, the credit gate
// and the live pipeline all live in the Studio, and duplicating them here would
// mean two code paths to keep honest. So it collects the source and the target
// and hands both to /studio through router state — the same preset handoff the
// language grid and the sidebar's "Dub a …" rows use.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import Page from '../components/Page'
import LogoMark from '../components/brand/LogoMark'
import AnimatedNumber from '../components/AnimatedNumber'
import FeedbackSection from '../components/FeedbackSection'
import { readLink } from '../components/LinkInput'
import { EASE_ENTRANCE, EASE_EXIT, rise, springLayout, stagger } from '../lib/motion'
import { useHealth, useLanguages } from '../lib/queries'
import { pipelineDown } from '../lib/api'
import { gradientFor } from '../lib/thumb'
import { useAuth } from '../lib/auth'
import { useWorks, workPair, workTitle } from '../lib/works'
import type { Language } from '../lib/types'

const LANG_COLS = { gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' } as const

// A stable identity for "not loaded yet", so the memos below don't recompute on
// every render while the languages query is still in flight.
const NO_LANGUAGES: Language[] = []

// TH-Labs leads with the Turkic family, so those languages get their own group
// at the top of the lab instead of being scattered through an alphabetical wall.
//
// This is a display order, not a claim of support: the grid only ever renders
// languages GET /v1/languages actually returned. Codes listed here that the
// backend does not serve yet (ky, tk, tt, ba, ug…) simply never match — and the
// moment the backend adds one, it appears in this group automatically.
const TURKIC_ORDER = ['uz', 'tr', 'kk', 'ky', 'tk', 'az', 'tt', 'ba', 'ug', 'kaa'] as const
const TURKIC = new Set<string>(TURKIC_ORDER)

function turkicRank(code: string): number {
  const i = TURKIC_ORDER.indexOf(code as (typeof TURKIC_ORDER)[number])
  return i === -1 ? TURKIC_ORDER.length : i
}

export default function Home() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { works } = useWorks()

  const languages = useLanguages()
  const health = useHealth()

  // "Nothing can be dubbed" has two causes: the account API is unreachable
  // (health.isError) or it reached the pipeline and the pipeline is down. Both
  // render the same, so collapse them once here rather than at each use.
  const dubbingDown = pipelineDown(health.data, health.isError)

  const [query, setQuery] = useState('')
  const [target, setTarget] = useState('uz')

  const firstName = user?.name?.trim().split(/\s+/)[0]
  const catalog = languages.data ?? NO_LANGUAGES

  // The account's own most-dubbed targets. Real personalisation — an account
  // with no dubs simply doesn't get this row.
  const favourites = useMemo(() => {
    const counts = new Map<string, number>()
    for (const w of works) counts.set(w.targetLang, (counts.get(w.targetLang) ?? 0) + 1)
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([code]) => catalog.find((l) => l.code === code))
      .filter((l): l is Language => !!l)
  }, [works, catalog])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return catalog
    return catalog.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.native.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q),
    )
  }, [catalog, query])

  // Turkic first, in TURKIC_ORDER; everything else keeps the catalog's order.
  const turkic = useMemo(
    () =>
      filtered
        .filter((l) => TURKIC.has(l.code))
        .sort((a, b) => turkicRank(a.code) - turkicRank(b.code)),
    [filtered],
  )
  const otherLangs = useMemo(() => filtered.filter((l) => !TURKIC.has(l.code)), [filtered])

  const inProgress = works.filter((w) => w.status === 'processing')
  const recent = works.filter((w) => w.status !== 'processing').slice(0, 4)

  const dubInto = (code: string) => navigate('/studio', { state: { targetLang: code } })

  return (
    <Page className="space-y-10">
      {/* ── A · The composer ────────────────────────────────────────────────
          The page's primary action, at the top, already open. */}
      <section className="space-y-4">
        <h1 className="text-[1.75rem] font-semibold tracking-tight text-primary">
          {firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
        </h1>
        <Composer
          languages={catalog}
          target={target}
          onTarget={setTarget}
          disabled={dubbingDown}
        />
      </section>

      {/* ── B · Quick start ─────────────────────────────────────────────────
          The three presets. They used to be four rows in the sidebar under an
          "Apps" heading, which was wrong twice over: all of them opened the
          same screen, so the nav claimed four applications where there is one,
          and a preset is a way to START something, not a place. Here they read
          correctly — three doors into the Studio, each pre-tuned. */}
      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
      >
        <QuickStart
          title="Dub a video"
          sub="Balanced quality, from a file or a link"
          icon={ICON.video}
          onClick={() => navigate('/studio', { state: { preset: 'video', targetLang: target } })}
        />
        <QuickStart
          title="Dub a podcast"
          sub="Audio only, studio quality"
          icon={ICON.podcast}
          onClick={() => navigate('/studio', { state: { preset: 'podcast', targetLang: target } })}
        />
        <QuickStart
          title="Clone a voice"
          sub="Keeps the original speaker"
          icon={ICON.voice}
          onClick={() => navigate('/studio', { state: { preset: 'voice', targetLang: target } })}
        />
      </motion.div>

      {/* ── C · The promo band ──────────────────────────────────────────────
          The one saturated surface left in the product. It sells the thing the
          product is actually for, and both its buttons go somewhere real. */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE_ENTRANCE }}
        className="promo grain px-6 py-12 text-center sm:py-16"
      >
        <div className="relative mx-auto max-w-xl">
          <h2 className="text-[1.9rem] font-semibold tracking-tight sm:text-[2.3rem]">
            Keep the speaker's own voice
          </h2>
          <p className="mt-2 text-[15px] text-white/75">
            {catalog.length > 0 ? (
              <>
                Dub into <AnimatedNumber value={catalog.length} duration={900} /> languages
                without losing who is talking.
              </>
            ) : (
              'Dub across languages without losing who is talking.'
            )}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/studio')}
              className="btn-on-deep focusable rounded-full px-5 py-2.5 text-sm"
            >
              Open the Studio
            </button>
            <a
              href="#language-lab"
              className="focusable rounded-full px-4 py-2.5 text-sm text-white/85 transition-colors hover:text-white"
            >
              Explore languages
            </a>
          </div>
        </div>
      </motion.section>

      {/* ── D · Active runs (only when something is actually running) ──────── */}
      {inProgress.length > 0 && (
        <Reveal className="space-y-3">
          <SectionHead title="In progress" />
          <div className="grid gap-3 md:grid-cols-2">
            {inProgress.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => navigate('/works')}
                className="card card-hover focusable relative flex items-center gap-4 overflow-hidden p-4 text-left"
              >
                <span className="beam" aria-hidden />
                <span className="h-12 w-16 shrink-0 rounded-lg" style={{ background: gradientFor(w.id) }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-primary">{workTitle(w)}</span>
                  <span className="mt-0.5 block text-[12px] text-muted">
                    {workPair(w)} · {w.stage ?? 'Starting…'}
                  </span>
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-sunken">
                    <span
                      className="block h-full rounded-full bg-[rgb(var(--c-text-primary))] transition-[width] duration-700"
                      style={{ width: `${Math.round((w.progress ?? 0) * 100)}%` }}
                    />
                  </span>
                </span>
                <span className="shrink-0 text-xs text-secondary">
                  {Math.round((w.progress ?? 0) * 100)}%
                </span>
              </button>
            ))}
          </div>
        </Reveal>
      )}

      {/* ── E · Language lab ──────────────────────────────────────────────── */}
      <Reveal className="space-y-4">
        <div id="language-lab" className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <SectionHead
            title="Languages"
            sub="Pick a target to open the Studio with it loaded."
          />

          <div className="relative lg:w-72">
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={ICON.search} />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search languages"
              className="field focusable py-2 pl-9 text-sm"
            />
          </div>
        </div>

        {/* Shortcut row built from the account's own history. */}
        {favourites.length > 0 && !query && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">You dub most</span>
            {favourites.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => dubInto(l.code)}
                className="chip focusable inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-secondary transition-colors hover:text-primary"
              >
                <span aria-hidden>{l.flag}</span>
                {l.name}
              </button>
            ))}
          </div>
        )}

        {languages.isError && catalog.length === 0 ? (
          <FailedCard
            title="Couldn't load the language catalog"
            body="The dubbing service didn't answer. Your other tools still work."
            onRetry={() => void languages.refetch()}
          />
        ) : filtered.length === 0 ? (
          <EmptySearch query={query} onClear={() => setQuery('')} />
        ) : (
          <div className="space-y-6">
            {turkic.length > 0 && (
              <div>
                <GroupHead title="Turkic languages" count={turkic.length} note="What TH-Labs is built for" />
                <motion.div layout className="mt-3 grid gap-3" style={LANG_COLS}>
                  <AnimatePresence mode="popLayout">
                    {turkic.map((l, i) => (
                      <LanguageCard key={l.code} lang={l} index={i} featured onClick={() => dubInto(l.code)} />
                    ))}
                  </AnimatePresence>
                </motion.div>
              </div>
            )}

            {otherLangs.length > 0 && (
              <div>
                <GroupHead title="Everything else" count={otherLangs.length} />
                <motion.div layout className="mt-3 grid gap-3" style={LANG_COLS}>
                  <AnimatePresence mode="popLayout">
                    {otherLangs.map((l, i) => (
                      <LanguageCard key={l.code} lang={l} index={i} onClick={() => dubInto(l.code)} />
                    ))}
                  </AnimatePresence>
                </motion.div>
              </div>
            )}
          </div>
        )}
      </Reveal>

      {/* ── F · Pipeline ──────────────────────────────────────────────────── */}
      <Reveal className="space-y-4">
        <SectionHead
          title="Pipeline"
          sub="The five stages every dub runs through, and which engine is loaded right now."
        />
        {/* An empty `stages` means the API could not reach the pipeline, so it
            has to render as the failure it is — an empty grid would read as a
            pipeline with nothing in it. */}
        {dubbingDown ? (
          <FailedCard
            title="Dubbing service unreachable"
            body="Nothing can be dubbed until it comes back. Sign-in, plans and your library are unaffected."
            onRetry={() => void health.refetch()}
          />
        ) : !health.data ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card shimmer h-24 bg-sunken" />
            ))}
          </div>
        ) : (
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.05 }}
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
          >
            {health.data.stages.map((s) => (
              <motion.div key={s.key} variants={rise} className="card p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-primary">{s.label}</span>
                  <span
                    className={`shrink-0 rounded-pill px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                      s.mode === 'real' ? 'bg-success/12 text-success' : 'bg-warn/12 text-warn'
                    }`}
                  >
                    {s.mode === 'real' ? 'live' : 'sim'}
                  </span>
                </div>
                <div className="mt-1 text-[12px] text-secondary">{s.engine}</div>
                {s.detail && <div className="mt-1 line-clamp-2 text-[11px] text-muted">{s.detail}</div>}
              </motion.div>
            ))}
          </motion.div>
        )}
      </Reveal>

      {/* ── G · Recent dubs ───────────────────────────────────────────────── */}
      {recent.length > 0 && (
        <Reveal className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <SectionHead title="Recent dubs" />
            <button
              type="button"
              onClick={() => navigate('/works')}
              className="focusable shrink-0 text-sm text-secondary transition-colors hover:text-primary"
            >
              View all →
            </button>
          </div>
          <div
            className="no-scrollbar flex snap-x gap-4 overflow-x-auto pb-1"
            style={{
              WebkitMaskImage: 'linear-gradient(to right, black 0, black calc(100% - 40px), transparent 100%)',
              maskImage: 'linear-gradient(to right, black 0, black calc(100% - 40px), transparent 100%)',
            }}
          >
            {recent.map((w, i) => (
              <motion.button
                key={w.id}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, ease: EASE_ENTRANCE, delay: i * 0.04 }}
                onClick={() => navigate('/works')}
                className="card card-hover focusable w-60 shrink-0 snap-start overflow-hidden p-0 text-left"
              >
                <div className="relative aspect-video overflow-hidden">
                  <div
                    className={`thumb-grad absolute inset-0 ${w.status === 'failed' ? 'grayscale' : ''}`}
                    style={{ backgroundImage: gradientFor(w.id) }}
                  />
                </div>
                <div className="p-3.5">
                  <div className="truncate text-sm font-medium text-primary">{workTitle(w)}</div>
                  <div className="mt-1 text-[12px] text-muted">
                    {workPair(w)} · {w.status === 'failed' ? 'failed' : fmtDur(w.durationSec ?? 0)}
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        </Reveal>
      )}

      {/* ── H · Feedback ──────────────────────────────────────────────────── */}
      {/* Last on the page on purpose: it is the one section that asks the user
          for something rather than showing them something, so it belongs after
          they have had a reason to form an opinion. */}
      <Reveal className="space-y-4 pb-4">
        <SectionHead
          title="Feedback"
          sub="Found a bug, or a dub that came out wrong? Tell us and it reaches the team directly."
        />
        <FeedbackSection />
      </Reveal>
    </Page>
  )
}

/* ── The composer ───────────────────────────────────────────────────────── */

type Mode = 'link' | 'upload'

/**
 * The card the dashboard opens with.
 *
 * Two ways in, as tabs rather than two always-visible fields: exactly one
 * source can be sent, and showing both filled-in invites the question of which
 * one wins. The link is validated here with the SAME `readLink` the Studio's
 * field uses, so a typo is caught before the navigation rather than after it.
 */
function Composer({
  languages,
  target,
  onTarget,
  disabled,
}: {
  languages: Language[]
  target: string
  onTarget: (code: string) => void
  disabled: boolean
}) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('link')
  const [url, setUrl] = useState('')

  const link = readLink(url)
  const ready = mode === 'upload' || !!link.url

  function go() {
    if (!ready) return
    navigate('/studio', {
      state:
        mode === 'link'
          ? { targetLang: target, link: link.url, preset: 'video' }
          : { targetLang: target, preset: 'video' },
    })
  }

  return (
    <div className="composer overflow-hidden">
      <div className="flex flex-wrap items-center gap-1 px-3 pt-3">
        <button type="button" data-active={mode === 'link'} onClick={() => setMode('link')} className="seg focusable">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d={ICON.link} />
          </svg>
          Paste a link
        </button>
        <button type="button" data-active={mode === 'upload'} onClick={() => setMode('upload')} className="seg focusable">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d={ICON.upload} />
          </svg>
          Upload a file
        </button>
      </div>

      <div className="min-h-[9.5rem] px-5 py-5 sm:min-h-[11rem]">
        {mode === 'link' ? (
          <>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && go()}
              placeholder="Paste a YouTube, Vimeo or direct video link…"
              aria-label="Video link"
              className="focusable w-full border-0 bg-transparent p-0 text-[17px] text-primary outline-none placeholder:text-muted"
            />
            <p className="mt-3 text-sm text-muted">
              {link.hint ??
                (link.source
                  ? `${link.source} link — the server fetches it for you.`
                  : 'The Studio takes it from here: source language, voice cloning and quality.')}
            </p>
          </>
        ) : (
          <div className="flex h-full flex-col justify-center">
            <p className="text-[17px] text-primary">Bring your own video or audio file</p>
            <p className="mt-2 max-w-md text-sm text-muted">
              Uploads run in the Studio, where the file is measured against your credit
              balance before anything is spent. This opens it ready for one.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-subtle px-3 py-3">
        <TargetPicker languages={languages} value={target} onChange={onTarget} />
        {disabled && (
          <span className="rounded-pill bg-danger/10 px-2.5 py-1 text-xs text-danger">
            Pipeline unreachable
          </span>
        )}
        <button
          type="button"
          onClick={go}
          disabled={!ready}
          className="btn-primary focusable ml-auto px-5 py-2.5 text-sm"
        >
          {mode === 'upload' ? 'Choose a file →' : 'Start dubbing →'}
        </button>
      </div>
    </div>
  )
}

/** The inline target-language dropdown in the composer's bottom bar. */
function TargetPicker({
  languages,
  value,
  onChange,
}: {
  languages: Language[]
  value: string
  onChange: (code: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = languages.find((l) => l.code === value)
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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="focusable inline-flex items-center gap-2 rounded-full border border-subtle bg-surface px-3 py-2 text-sm text-primary transition-colors hover:border-strong"
      >
        <span aria-hidden>{selected?.flag ?? '🌐'}</span>
        <span className="max-w-[9rem] truncate">{selected?.name ?? 'Loading…'}</span>
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9.5 12 15l6-5.5" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.13 }}
            className="absolute bottom-[calc(100%+0.5rem)] left-0 z-50 w-72 overflow-hidden rounded-xl border border-subtle bg-raised p-1.5 shadow-[var(--shadow-lg)]"
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
              placeholder="Search languages"
              className="field focusable mb-1.5 py-2 text-sm"
            />
            <div className="no-scrollbar max-h-64 overflow-y-auto">
              {filtered.length === 0 && (
                <p className="px-2.5 py-3 text-sm text-muted">No language matches.</p>
              )}
              {filtered.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  role="option"
                  aria-selected={l.code === value}
                  onClick={() => {
                    onChange(l.code)
                    setOpen(false)
                    setQ('')
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-sunken ${
                    l.code === value ? 'bg-sunken text-primary' : 'text-secondary'
                  }`}
                >
                  <span aria-hidden>{l.flag}</span>
                  <span className="min-w-0 flex-1 truncate">{l.name}</span>
                  <span className="shrink-0 text-[11px] uppercase text-muted">{l.code}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Blocks ─────────────────────────────────────────────────────────────── */

/**
 * A section that animates in the first time it is scrolled to, and then stays
 * put. `once` matters: a section that re-animates every time it re-enters the
 * viewport turns a scroll back up the page into a light show.
 */
function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.05 }}
      transition={{ duration: 0.4, ease: EASE_ENTRANCE }}
      className={className}
    >
      {children}
    </motion.section>
  )
}

/** One of the three preset doors into the Studio. */
function QuickStart({
  title,
  sub,
  icon,
  onClick,
}: {
  title: string
  sub: string
  icon: string
  onClick: () => void
}) {
  return (
    <motion.button
      type="button"
      variants={rise}
      onClick={onClick}
      className="card card-hover focusable group flex items-center gap-3.5 p-4 text-left"
    >
      <span className="icon-tile grid h-10 w-10 shrink-0 bg-sunken text-primary">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d={icon} />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-primary">{title}</span>
        <span className="mt-0.5 block text-[12px] text-muted">{sub}</span>
      </span>
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </motion.button>
  )
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <h2 className="text-[1.05rem] font-semibold tracking-tight text-primary">{title}</h2>
      {sub && <p className="mt-1 text-sm text-secondary">{sub}</p>}
    </div>
  )
}

function GroupHead({ title, count, note }: { title: string; count: number; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span className="text-sm font-medium text-primary">{title}</span>
      <span className="text-[12px] text-muted">{count}</span>
      {note && <span className="text-[12px] text-muted">· {note}</span>}
    </div>
  )
}

function LanguageCard({
  lang,
  index,
  featured,
  onClick,
}: {
  lang: Language
  index: number
  featured?: boolean
  onClick: () => void
}) {
  const reduce = useReducedMotion()
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14, ease: EASE_EXIT } }}
      transition={{
        layout: springLayout,
        duration: 0.24,
        ease: EASE_ENTRANCE,
        delay: reduce ? 0 : Math.min(index, 14) * 0.015,
      }}
      onClick={onClick}
      className={`card card-hover focusable flex items-center gap-3 p-3.5 text-left ${
        featured ? 'bg-sunken/60' : ''
      }`}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-sunken text-xl" aria-hidden>
        {lang.flag}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-primary">{lang.native}</span>
        <span className="block truncate text-[12px] text-muted">{lang.name}</span>
      </span>
      <span className="shrink-0 text-[11px] uppercase text-muted">{lang.code}</span>
    </motion.button>
  )
}

function EmptySearch({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="relative grid min-h-[220px] place-items-center overflow-hidden rounded-[var(--radius-card)] border border-subtle bg-sunken/50 px-6 text-center">
      <LogoMark className="pointer-events-none absolute -bottom-12 -right-12 h-[220px] w-[220px] text-primary/[0.035]" />
      <div className="relative">
        <div className="text-lg font-medium text-primary">No language matches “{query}”</div>
        <p className="mx-auto mt-2 max-w-sm text-sm text-secondary">
          Try the English name, the native name, or the two-letter code.
        </p>
        <button type="button" onClick={onClear} className="btn-ghost focusable mt-5 px-5 py-2.5 text-sm">
          Clear search
        </button>
      </div>
    </div>
  )
}

function FailedCard({ title, body, onRetry }: { title: string; body: string; onRetry: () => void }) {
  return (
    <div className="card grid min-h-[200px] place-items-center p-8 text-center">
      <div>
        <span className="icon-tile mx-auto mb-3 grid h-11 w-11 bg-danger/10 text-danger">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8v5M12 16.5h.01M10.3 4.3 3.4 16a2 2 0 0 0 1.7 3h13.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
          </svg>
        </span>
        <div className="text-base font-medium text-primary">{title}</div>
        <p className="mx-auto mt-1.5 max-w-xs text-sm text-secondary">{body}</p>
        <button type="button" onClick={onRetry} className="btn-ghost focusable mt-4 px-5 py-2 text-sm">
          Retry
        </button>
      </div>
    </div>
  )
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const ICON = {
  search: 'M11 4a7 7 0 1 0 4.95 11.95A7 7 0 0 0 11 4zM21 21l-4.35-4.35',
  link: 'M10 13.5a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66l-1.1 1.1M14 10.5a4 4 0 0 0-5.66 0l-2.83 2.83a4 4 0 0 0 5.66 5.66l1.1-1.1',
  upload: 'M12 16V4M7.5 8.5 12 4l4.5 4.5M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16',
  video: 'M4 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM16 10l4-2v8l-4-2',
  podcast: 'M6 10v4M9.5 7.5v9M13 5v14M16.5 8.5v7M20 11v2',
  voice: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3.5 20a5.5 5.5 0 0 1 11 0M16 12.5l2 2 4-4',
} as const
