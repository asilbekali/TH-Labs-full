// Dashboard (01).
//
// Everything on this page is live: the language grid is GET /v1/languages, the
// pipeline strip is GET /v1/health, and the activity row is the user's own
// dubs. The old template gallery was removed — it was a fixed list of invented
// clips that could not actually be opened.
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import Page from '../components/Page'
import LogoMark from '../components/brand/LogoMark'
import AnimatedNumber from '../components/AnimatedNumber'
import ThinkingOrbs from '../components/ThinkingOrbs'
import { usePointerSpotlight } from '../hooks/usePointerSpotlight'
import { EASE_ENTRANCE, EASE_EXIT, rise, springLayout, stagger } from '../lib/motion'
import { useHealth, useLanguages } from '../lib/queries'
import { pipelineDown } from '../lib/api'
import { gradientFor } from '../lib/thumb'
import { useAuth } from '../lib/auth'
import { useWorks, workPair, workTitle } from '../lib/works'
import type { Language } from '../lib/types'

const LANG_COLS = { gridTemplateColumns: 'repeat(auto-fill, minmax(178px, 1fr))' } as const

// A stable identity for "not loaded yet", so the memos below don't recompute on
// every render while the languages query is still in flight.
const NO_LANGUAGES: Language[] = []

// TH-Labs leads with the Turkic family, so those languages get their own group
// at the top of the lab instead of being scattered through an alphabetical wall.
//
// This is a display order, not a claim of support: the grid only ever renders
// languages GET /api/languages actually returned. Codes listed here that the
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

  // "Nothing can be dubbed" now has two causes: the account API is unreachable
  // (health.isError) or it reached the pipeline and the pipeline is down. Both
  // render the same, so collapse them once here rather than at each use.
  const dubbingDown = pipelineDown(health.data, health.isError)

  const [query, setQuery] = useState('')

  const firstName = user?.name?.trim().split(/\s+/)[0]
  const catalog = languages.data ?? NO_LANGUAGES

  // The user's own most-dubbed targets, newest activity first. Real
  // personalisation — an account with no dubs simply doesn't get this row.
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

  const openPreset = (preset: 'video' | 'podcast' | 'voice') => navigate('/studio', { state: { preset } })
  const dubInto = (code: string) => navigate('/studio', { state: { targetLang: code } })

  return (
    <Page className="space-y-8">
      {/* ── A · Hero ──────────────────────────────────────────────────────────
          The one saturated surface on the dashboard, and the only thing on the
          page that moves with nothing to report: light turns behind it, the
          orbs swim, and the target language cycles through the catalog. That
          is deliberate — this is the screen an account lands on and comes back
          to, so it has to look alive before the user has done anything. */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE_ENTRANCE }}
        className="deep-card aurora grain px-5 py-5 sm:px-7 sm:py-6"
      >
        {/* Height is deliberately restrained: on the fixed desktop shell the
            whole page is one 100vh column, and a taller hero pushes the three
            quick-start cards below the fold where nobody finds them. */}
        <div className="above flex flex-wrap-reverse items-center justify-between gap-x-8 gap-y-5">
          <div className="min-w-0 flex-1 basis-[19rem]">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] on-deep-dim">
              / 01 — Dashboard
            </span>
            <h1 className="mt-1.5 font-mono text-[1.65rem] font-medium leading-[1.12] tracking-tight sm:text-[1.95rem]">
              Welcome back
              {firstName ? (
                <>
                  , <span className="text-mesh">{firstName}</span>
                </>
              ) : null}
            </h1>

            <TargetTicker languages={catalog} />

            <div className="mt-4 flex flex-wrap gap-2.5">
              <span className="chip-deep px-3.5 py-2 font-mono text-xs">
                <HeroIcon d={ICON.globe} />
                {catalog.length > 0 ? (
                  <span>
                    <AnimatedNumber value={catalog.length} duration={900} /> languages
                  </span>
                ) : (
                  <span className="on-deep-dim">Loading languages…</span>
                )}
              </span>
              <span className="chip-deep px-3.5 py-2 font-mono text-xs">
                {/* The dot only pings while the reading is actually live. */}
                {dubbingDown ? (
                  <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[rgb(255_140_140)]" />
                ) : (
                  <span className="pulse-dot text-[rgb(var(--mesh-a))]" />
                )}
                {dubbingDown
                  ? 'Pipeline unreachable'
                  : health.data
                    ? `${health.data.stages.filter((s) => s.mode === 'real').length}/${health.data.stages.length} stages live`
                    : 'Checking pipeline…'}
              </span>
            </div>
          </div>

          {/* Decoration, and announced as such: the orbs say nothing the chips
              above do not already say in words. */}
          <div className="relative grid shrink-0 place-items-center pr-1 sm:pr-3">
            <ThinkingOrbs size={104} speed={16} className="sm:hidden" />
            <ThinkingOrbs size={124} speed={16} className="hidden sm:inline-block" />
          </div>
        </div>
      </motion.section>

      {/* The catalog, scrolling forever. Hovering parks it so a name can be
          clicked; the grid below is the accessible way in, which is why the
          ribbon is hidden from screen readers and skipped by the tab key. */}
      {catalog.length > 5 && <LanguageRibbon languages={catalog} onPick={dubInto} />}

      {/* ── B · Quick start ───────────────────────────────────────────────── */}
      {/* Animates on mount, not on scroll: this row sits right under the hero
          and is the page's primary action — it must never be waiting on an
          intersection that a short viewport might not deliver. */}
      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-5 md:grid-cols-3"
      >
        <QuickStartCard tint="brand" title="Dub a video" sub="From a file you upload" icon={ICON.video} onClick={() => openPreset('video')} />
        <QuickStartCard tint="magenta" title="Dub a podcast" sub="Audio only, studio quality" icon={ICON.mic} onClick={() => openPreset('podcast')} />
        <QuickStartCard tint="gold" title="Clone a voice" sub="Keeps the original speaker" icon={ICON.userCheck} onClick={() => openPreset('voice')} />
      </motion.div>

      {/* ── C · Active runs (only when something is actually running) ──────── */}
      {inProgress.length > 0 && (
        <Reveal>
          <SectionHead label="In progress" />
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {inProgress.map((w) => (
              <motion.button
                key={w.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => navigate('/works')}
                className="card card-hover running-halo sheen focusable relative flex items-center gap-4 overflow-hidden p-4 text-left"
              >
                {/* The same two live cues the Studio uses for a running job. */}
                <span className="beam" aria-hidden />
                <span className="h-12 w-16 shrink-0 rounded-lg" style={{ background: gradientFor(w.id) }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-sm font-medium text-primary">{workTitle(w)}</span>
                  <span className="mt-0.5 block font-mono text-[11px] text-muted">
                    {workPair(w)} · {w.stage ?? 'Starting…'}
                  </span>
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-sunken">
                    <span
                      className="block h-full rounded-full bg-[rgb(var(--c-brand-500))] transition-[width] duration-700"
                      style={{ width: `${Math.round((w.progress ?? 0) * 100)}%` }}
                    />
                  </span>
                </span>
                <span className="shrink-0 font-mono text-xs text-secondary">
                  {Math.round((w.progress ?? 0) * 100)}%
                </span>
              </motion.button>
            ))}
          </div>
        </Reveal>
      )}

      {/* ── D · Language lab ──────────────────────────────────────────────── */}
      <Reveal>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <SectionHead label="Language lab" />
            <p className="mt-1.5 text-sm text-secondary">
              Pick a target language to open the Studio with it loaded.
              {catalog.length > 0 && (
                <span className="text-muted"> Whisper transcribes, NLLB translates.</span>
              )}
            </p>
          </div>

          <div className="relative lg:w-64">
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={ICON.search} />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search languages"
              className="focusable w-full rounded-control border border-subtle bg-sunken py-2 pl-9 pr-3 text-sm text-primary outline-none transition-colors placeholder:text-muted hover:border-brand/40"
            />
          </div>
        </div>

        {/* Shortcut row built from the user's own history. */}
        {favourites.length > 0 && !query && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">You dub most</span>
            {favourites.map((l) => (
              <button
                key={l.code}
                onClick={() => dubInto(l.code)}
                className="chip focusable inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs text-secondary transition-colors hover:text-primary"
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
          <div className="mt-5 space-y-6">
            {turkic.length > 0 && (
              <div>
                <GroupHead
                  title="Turkic languages"
                  count={turkic.length}
                  note="What TH-Labs is built for"
                  featured
                />
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

      {/* ── E · Pipeline ──────────────────────────────────────────────────── */}
      <Reveal>
        <SectionHead label="Pipeline" />
        <p className="mt-1.5 text-sm text-secondary">
          The five stages every dub runs through, and which engine is loaded right now.
        </p>
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
          <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
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
            className="mt-4 grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
          >
            {health.data.stages.map((s) => (
              <motion.div key={s.key} variants={rise} className="card p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-sm font-medium text-primary">{s.label}</span>
                  <span
                    className={`shrink-0 rounded-pill px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                      s.mode === 'real' ? 'bg-success/12 text-success' : 'bg-warn/12 text-warn'
                    }`}
                  >
                    {s.mode === 'real' ? 'live' : 'sim'}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-secondary">{s.engine}</div>
                {s.detail && <div className="mt-1 line-clamp-2 text-[11px] text-muted">{s.detail}</div>}
              </motion.div>
            ))}
          </motion.div>
        )}
      </Reveal>

      {/* ── F · Recent dubs ───────────────────────────────────────────────── */}
      {recent.length > 0 && (
        <Reveal>
          <div className="flex items-center justify-between">
            <SectionHead label="Recent dubs" />
            <button onClick={() => navigate('/works')} className="focusable font-mono text-[11px] text-brand hover:underline">
              View all →
            </button>
          </div>
          <div
            className="no-scrollbar mt-3 flex snap-x gap-4 overflow-x-auto pb-1"
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
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => navigate('/works')}
                className="card card-hover sheen focusable w-60 shrink-0 snap-start overflow-hidden p-0 text-left"
              >
                <div className="relative aspect-video overflow-hidden">
                  <div
                    className={`thumb-grad absolute inset-0 ${w.status === 'failed' ? 'grayscale' : ''}`}
                    style={{ backgroundImage: gradientFor(w.id) }}
                  />
                </div>
                <div className="p-3.5">
                  <div className="truncate font-mono text-sm font-medium text-primary">{workTitle(w)}</div>
                  <div className="mt-1 font-mono text-[11px] text-muted">
                    {workPair(w)} · {w.status === 'failed' ? 'failed' : fmtDur(w.durationSec ?? 0)}
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        </Reveal>
      )}
    </Page>
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
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.05 }}
      transition={{ duration: 0.45, ease: EASE_ENTRANCE }}
      className={className}
    >
      {children}
    </motion.section>
  )
}

/**
 * The hero's second line: one target language at a time, swapped every 2.6s.
 *
 * It is the page's one piece of ambient copy, and it does real work — it is
 * how someone learns the catalog is 40 languages deep without reading a grid.
 * Reduced motion parks it on the first entry rather than cross-fading forever.
 */
function TargetTicker({ languages }: { languages: Language[] }) {
  const reduce = useReducedMotion()
  const [i, setI] = useState(0)

  useEffect(() => {
    if (reduce || languages.length < 2) return
    const id = setInterval(() => setI((n) => n + 1), 2600)
    return () => clearInterval(id)
  }, [reduce, languages.length])

  const lang = languages.length > 0 ? languages[i % languages.length] : null

  return (
    <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[15px] leading-relaxed on-deep-dim">
      Keep the speaker's own voice — dub into
      <span className="relative inline-flex min-w-[8.5rem] items-baseline">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={lang?.code ?? 'loading'}
            initial={{ opacity: 0, y: 7 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -7 }}
            transition={{ duration: 0.26, ease: EASE_ENTRANCE }}
            className="font-mono font-medium text-[rgb(var(--on-deep))]"
          >
            {lang ? `${lang.flag} ${lang.native}` : 'any language'}
          </motion.span>
        </AnimatePresence>
      </span>
    </p>
  )
}

/**
 * The catalog as a ribbon that scrolls forever under the hero.
 *
 * The track holds the list twice and travels exactly -50%, so the loop has no
 * seam (see `.marquee` in index.css). Duration scales with the item count so a
 * 40-language catalog does not fly past faster than a 12-language one.
 *
 * It must never be wider than its column. An earlier version bled into the
 * page gutter with negative margins, which on the fixed desktop shell widened
 * the whole content box — the page gained a horizontal scrollbar and the third
 * quick-start card went off the right edge. The edge fade is the mask on
 * `.marquee`, not extra width.
 *
 * It is hidden from assistive tech and skipped by the tab key on purpose: every
 * name in it is also in the grid below, where it is reachable in a sane order.
 */
function LanguageRibbon({
  languages,
  onPick,
}: {
  languages: Language[]
  onPick: (code: string) => void
}) {
  const loop = useMemo(() => [...languages, ...languages], [languages])
  return (
    <div
      aria-hidden
      className="marquee"
      style={{ '--marquee-dur': `${Math.max(30, languages.length * 1.7)}s` } as CSSProperties}
    >
      <div className="marquee__track py-1">
        {loop.map((l, i) => (
          <button
            key={`${l.code}-${i}`}
            tabIndex={-1}
            onClick={() => onPick(l.code)}
            className="group mx-1 inline-flex shrink-0 items-center gap-2 rounded-pill border border-subtle bg-surface/70 px-3.5 py-2 font-mono text-xs text-secondary transition-colors hover:border-brand/45 hover:text-brand"
          >
            <span className="text-sm" aria-hidden>
              {l.flag}
            </span>
            {l.native}
            <span className="text-[10px] uppercase text-muted transition-colors group-hover:text-brand/70">
              {l.code}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** A 14px stroked glyph, sized for the hero's chips. */
function HeroIcon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 shrink-0 on-deep-dim"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  )
}

/** A group heading inside the lab. `featured` gives the Turkic block its accent. */
function GroupHead({
  title,
  count,
  note,
  featured,
}: {
  title: string
  count: number
  note?: string
  featured?: boolean
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span className={`font-mono text-sm font-medium ${featured ? 'text-brand' : 'text-secondary'}`}>
        {title}
      </span>
      <span className="font-mono text-[11px] text-muted">{count}</span>
      {note && <span className="text-[11px] text-muted">· {note}</span>}
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
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15, ease: EASE_EXIT } }}
      transition={{ layout: springLayout, duration: 0.28, ease: EASE_ENTRANCE, delay: Math.min(index, 14) * 0.02 }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`card sheen group focusable flex items-center gap-3 p-3.5 text-left transition-colors hover:border-brand/40 ${
        featured ? 'border-brand/30 bg-brand/[0.04]' : ''
      }`}
    >
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-control text-xl ${
          featured ? 'bg-brand/10' : 'bg-sunken'
        }`}
        aria-hidden
      >
        {lang.flag}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-sm font-medium text-primary">{lang.native}</span>
        <span className="block truncate text-[11px] text-muted">{lang.name}</span>
      </span>
      <span
        className={`shrink-0 font-mono text-[10px] uppercase transition-colors group-hover:text-brand ${
          featured ? 'text-brand/70' : 'text-muted'
        }`}
      >
        {lang.code}
      </span>
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
  tint: 'brand' | 'magenta' | 'gold'
  title: string
  sub: string
  icon: string
  onClick: () => void
}) {
  const tintClass = { brand: 'bg-brand/12 text-brand', magenta: 'bg-magenta/12 text-magenta', gold: 'bg-gold/12 text-gold' }[tint]
  const spot = usePointerSpotlight<HTMLButtonElement>()
  return (
    <motion.button
      ref={spot.ref}
      onPointerEnter={spot.onPointerEnter}
      onPointerMove={spot.onPointerMove}
      variants={rise}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      onClick={onClick}
      className="card card-hover spotlight sheen group focusable flex items-center gap-4 p-5 text-left md:flex-col md:items-start md:gap-3"
    >
      <span className={`icon-tile above h-12 w-12 shrink-0 ${tintClass}`}>
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d={icon} />
        </svg>
      </span>
      <span className="above min-w-0 flex-1 md:flex-none">
        <span className="block font-mono text-[17px] font-medium text-primary">{title}</span>
        <span className="mt-0.5 block text-sm text-secondary">{sub}</span>
      </span>
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-[3px] md:mt-1 md:self-end" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={ICON.arrow} />
      </svg>
    </motion.button>
  )
}

function SectionHead({ label }: { label: string }) {
  return (
    <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">/ {label}</span>
  )
}

function EmptySearch({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="relative mt-4 grid min-h-[220px] place-items-center overflow-hidden rounded-[var(--radius-card)] border border-subtle bg-sunken/40 px-6 text-center">
      <LogoMark className="pointer-events-none absolute -bottom-12 -right-12 h-[220px] w-[220px] text-primary/[0.045]" />
      <div className="relative">
        <div className="font-mono text-lg font-medium text-primary">No language matches "{query}"</div>
        <p className="mx-auto mt-2 max-w-sm text-sm text-secondary">
          Try the English name, the native name, or the two-letter code.
        </p>
        <button onClick={onClear} className="btn-ghost focusable mt-5 px-5 py-2.5 font-mono text-sm">
          Clear search
        </button>
      </div>
    </div>
  )
}

function FailedCard({ title, body, onRetry }: { title: string; body: string; onRetry: () => void }) {
  return (
    <div className="card mt-4 grid min-h-[200px] place-items-center p-8 text-center">
      <div>
        <span className="icon-tile mx-auto mb-3 grid h-11 w-11 bg-danger/12 text-danger">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8v5M12 16.5h.01M10.3 4.3 3.4 16a2 2 0 0 0 1.7 3h13.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
          </svg>
        </span>
        <div className="font-mono text-base font-medium text-primary">{title}</div>
        <p className="mx-auto mt-1.5 max-w-xs text-sm text-secondary">{body}</p>
        <button onClick={onRetry} className="btn-ghost focusable mt-4 px-5 py-2 font-mono text-sm">
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
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3.5 12h17M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18',
  bolt: 'M13 2 5 13h6l-1 9 8-11h-6z',
  video: 'M4 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM16 10l4-2v8l-4-2',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  userCheck: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3.5 20a5.5 5.5 0 0 1 11 0M16 12.5l2 2 4-4',
  search: 'M11 4a7 7 0 1 0 4.95 11.95A7 7 0 0 0 11 4zM21 21l-4.35-4.35',
  arrow: 'M5 12h14M13 6l6 6-6 6',
} as const
