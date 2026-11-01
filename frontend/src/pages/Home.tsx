// Dashboard (01).
//
// The page opens the way a tool should: with the thing you came to do, already
// on screen. The composer is the first card — paste a link or pick an upload,
// choose a target language, go — with the balance beside it, and everything
// under it is context: the account at a glance, what you have dubbed and into
// what, your latest dubs, then the language lab, the pipeline and feedback.
//
// Everything here is live. The language grid is GET /v1/languages, the pipeline
// strip is GET /v1/health, the chart, the ring and the activity rows are the
// account's own dubs, and
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
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import Page from '../components/Page'
import LogoMark from '../components/brand/LogoMark'
import AnimatedNumber from '../components/AnimatedNumber'
import FeedbackSection from '../components/FeedbackSection'
import { readLink } from '../components/LinkInput'
import { EASE_ENTRANCE, EASE_EXIT, rise, springLayout, stagger } from '../lib/motion'
import { useHealth, useLanguages } from '../lib/queries'
import { mediaUrl, pipelineDown } from '../lib/api'
import WorkThumb from '../components/WorkThumb'
import { useAuth } from '../lib/auth'
import { relTime, useWorks, workPair, workTitle, type Work } from '../lib/works'
import { affordableSeconds, CREDITS_PER_MINUTE_BY_QUALITY, useWallet } from '../lib/wallet'
import type { Language } from '../lib/types'
import LangIcon from '../components/LangIcon'

// Two columns on a phone; on wider screens as many 190px columns as fit.
const LANG_GRID = 'grid grid-cols-2 gap-2 sm:gap-3 sm:[grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]'

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

  // One rule for "can a dub be started right now": the API answered AND it has
  // pipeline stages. See pipelineDown in lib/api.ts.
  const dubbingDown = pipelineDown(health.data, health.isError)

  const [query, setQuery] = useState('')
  // The composer's target. Defaults to Uzbek — the language TH-Labs is built
  // for — and is shared with the quick-start rows, so picking a language once
  // carries into whichever door you go through.
  const [target, setTarget] = useState('uz')
  const [allLangs, setAllLangs] = useState(false)
  // Phones show the pipeline as one status line and the feedback form behind a
  // button; these open the full versions.
  const [pipelineOpen, setPipelineOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  const firstName = user?.name?.trim().split(/\s+/)[0]
  const catalog = languages.data ?? NO_LANGUAGES

  // "You dub most" — the account's own top target languages, so the shortcut
  // row reflects what this person actually does rather than a fixed list.
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
    <Page className="space-y-4">
      {/* ── A · The composer, and the balance beside it ─────────────────────
          The page's primary action, at the top, already open. */}
      <div className="flex flex-wrap items-stretch gap-4">
        <Composer
          firstName={firstName}
          languages={catalog}
          target={target}
          onTarget={setTarget}
          disabled={dubbingDown}
        />
        <BalanceCard works={works} />
      </div>

      {/* ── B · At a glance ───────────────────────────────────────────────── */}
      <AtAGlance
        works={works}
        languages={catalog}
        pipeline={dubbingDown ? 'down' : health.data ? 'up' : 'checking'}
      />

      {/* ── C · What you have dubbed, and into what ─────────────────────────
          Desktop only: on a phone they are two screens of scrolling between
          the composer and your dubs. */}
      <div className="hidden flex-wrap items-stretch gap-4 lg:flex">
        <MinutesChart works={works} />
        <WhereYouDub works={works} languages={catalog} onDub={dubInto} />
      </div>

      {/* ── D · Active runs (only when something is actually running) ──────── */}
      {inProgress.length > 0 && (
        <Reveal className="card gap-1 p-6">
          <SectionHead title="In progress" />
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            {inProgress.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => navigate('/works')}
                className="inner focusable relative flex items-center gap-4 overflow-hidden rounded-full p-2 pr-5 text-left"
              >
                <span className="beam" aria-hidden />
                <span className="relative h-11 w-16 shrink-0 overflow-hidden rounded-full">
                  <WorkThumb work={w} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-primary">{workTitle(w)}</span>
                  <span className="mt-0.5 block text-[12px] text-muted">
                    {workPair(w)} · {w.stage ?? 'Starting…'}
                  </span>
                  <span className="hatch mt-2 block h-1.5 overflow-hidden rounded-full">
                    <span
                      className="bar-ac block h-full rounded-full transition-[width] duration-700"
                      style={{ width: `${Math.round((w.progress ?? 0) * 100)}%` }}
                    />
                  </span>
                </span>
                <span className="num shrink-0 text-xs text-secondary">
                  {Math.round((w.progress ?? 0) * 100)}%
                </span>
              </button>
            ))}
          </div>
        </Reveal>
      )}

      {/* ── E · Recent dubs, and the ways to start another ────────────────── */}
      <div className="flex flex-wrap items-stretch gap-4">
        <RecentDubs works={recent} />
        <QuickStartCard target={target} />
      </div>

      {/* ── F · Language lab ──────────────────────────────────────────────── */}
      <Reveal className="space-y-3 pt-6 sm:space-y-4">
        <div id="language-lab" className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <SectionHead
            title="Languages"
            sub="Pick a target to open the Studio with it loaded."
            subDesktopOnly
          />

          <div className="relative lg:w-72">
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={ICON.search} />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search languages"
              className="field focusable py-2.5 pl-10 text-sm"
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
                className="btn-ghost focusable inline-flex h-[34px] items-center gap-2 pl-1.5 pr-3.5 text-[13px]"
              >
                <LangIcon code={l.code} flag={l.flag} size={22} />
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
                <motion.div layout className={`mt-3 ${LANG_GRID}`}>
                  <AnimatePresence mode="popLayout">
                    {turkic.map((l, i) => (
                      <LanguageCard key={l.code} lang={l} index={i} featured onClick={() => dubInto(l.code)} />
                    ))}
                  </AnimatePresence>
                </motion.div>
              </div>
            )}

            {/* Phones show the Turkic group and hold the rest behind a button,
                so the catalog does not bury everything under it. A search
                always shows every match. */}
            {otherLangs.length > 0 && !allLangs && !query && (
              <button
                type="button"
                onClick={() => setAllLangs(true)}
                className="btn-ghost focusable w-full py-3 text-sm sm:hidden"
              >
                Show {otherLangs.length} more languages
              </button>
            )}
            {otherLangs.length > 0 && (
              <div className={allLangs || query ? '' : 'hidden sm:block'}>
                <GroupHead title="Everything else" count={otherLangs.length} />
                <motion.div layout className={`mt-3 ${LANG_GRID}`}>
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

      {/* ── G · Pipeline ──────────────────────────────────────────────────── */}
      <Reveal className="space-y-3 pt-6 sm:space-y-4">
        <SectionHead
          title="Pipeline"
          sub="The five stages every dub runs through, and which engine is loaded right now."
          subDesktopOnly
        />
        {/* An empty `stages` means the API could not reach the pipeline, so it
            has to render as the failure it is — an empty grid would read as a
            pipeline with nothing in it. */}
        {/* Phones get one status line; the stage cards open on tap. */}
        {!dubbingDown && health.data && (
          <button
            type="button"
            onClick={() => setPipelineOpen((v) => !v)}
            aria-expanded={pipelineOpen}
            className="card focusable flex w-full flex-row items-center gap-3 rounded-full p-4 text-left sm:hidden"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden />
            <span className="min-w-0 flex-1 text-sm text-primary">
              {health.data.stages.filter((st) => st.mode === 'real').length} of{' '}
              {health.data.stages.length} stages live
            </span>
            <span className="text-sm text-muted">{pipelineOpen ? 'Hide' : 'Details'}</span>
          </button>
        )}
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
            className={`gap-3 ${pipelineOpen ? 'grid' : 'hidden sm:grid'}`}
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
          >
            {health.data.stages.map((s) => (
              <motion.div key={s.key} variants={rise} className="card p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-primary">{s.label}</span>
                  <span className="chip inline-flex shrink-0 items-center gap-1.5 px-2.5 py-0.5 text-[11px] text-primary">
                    <span
                      aria-hidden
                      className={`h-1.5 w-1.5 rounded-full ${s.mode === 'real' ? 'bg-success' : 'bg-warn'}`}
                    />
                    {s.mode === 'real' ? 'Live' : 'Sim'}
                  </span>
                </div>
                <div className="mt-1 text-[12px] text-secondary">{s.engine}</div>
                {s.detail && <div className="mt-1 line-clamp-2 text-[11px] text-muted">{s.detail}</div>}
              </motion.div>
            ))}
          </motion.div>
        )}
      </Reveal>

      {/* ── H · Feedback ──────────────────────────────────────────────────── */}
      {/* Last on the page on purpose: it is the one section that asks the user
          for something rather than showing them something, so it belongs after
          they have had a reason to form an opinion. */}
      <Reveal className="space-y-3 pb-4 pt-6 sm:space-y-4">
        <SectionHead
          title="Feedback"
          sub="Found a bug, or a dub that came out wrong? Tell us and it reaches the team directly."
          subDesktopOnly
        />
        {!feedbackOpen && (
          <button
            type="button"
            onClick={() => setFeedbackOpen(true)}
            className="btn-ghost focusable w-full py-3 text-sm sm:hidden"
          >
            Send feedback
          </button>
        )}
        <div className={feedbackOpen ? '' : 'hidden sm:block'}>
          <FeedbackSection />
        </div>
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
  firstName,
  languages,
  target,
  onTarget,
  disabled,
}: {
  firstName?: string
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
    <motion.section
      aria-label="New dub"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_ENTRANCE }}
      className="composer flex min-w-0 flex-[2_1_600px] flex-col gap-5 p-5 sm:gap-6 sm:p-8"
    >
      <span aria-hidden className="glow -bottom-[200px] -right-[140px] h-[420px] w-[560px] bg-[var(--glow-1)]" />
      <span aria-hidden className="glow -bottom-[180px] right-[300px] h-[240px] w-[280px] bg-[var(--glow-2)]" />

      <h1 className="relative text-[32px] font-semibold leading-9 tracking-[-0.035em] text-primary lg:text-[40px] lg:leading-[44px]">
        {firstName ? `Welcome back, ${firstName}.` : 'Welcome back.'}
        <br />
        <span className="font-light text-muted">What are we dubbing today?</span>
      </h1>

      <div className="relative flex flex-col gap-3">
        <div role="tablist" aria-label="Source" className="seg-track self-start">
          <button type="button" role="tab" aria-selected={mode === 'link'} data-active={mode === 'link'} onClick={() => setMode('link')} className="seg focusable">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d={ICON.link} />
            </svg>
            Paste a link
          </button>
          <button type="button" role="tab" aria-selected={mode === 'upload'} data-active={mode === 'upload'} onClick={() => setMode('upload')} className="seg focusable">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d={ICON.upload} />
            </svg>
            Upload a file
          </button>
        </div>

        {mode === 'link' ? (
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go()}
            placeholder="Paste a YouTube, Vimeo or direct video link"
            aria-label="Video link"
            className="field focusable h-14 px-5 text-base lg:h-16"
          />
        ) : (
          <button
            type="button"
            onClick={go}
            className="field focusable flex h-14 items-center gap-3 px-5 text-left text-base text-muted lg:h-16"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d={ICON.upload} />
            </svg>
            Bring your own video or audio file
          </button>
        )}
        <p className="px-2 text-[13px] text-muted">
          {mode === 'upload'
            ? 'Uploads run in the Studio, where the file is measured against your balance before anything is spent.'
            : (link.hint ??
              (link.source
                ? `${link.source} link — the server fetches it for you.`
                : 'The Studio takes it from here: source language, voice cloning and quality.'))}
        </p>
      </div>

      <div className="relative flex flex-wrap items-center gap-2.5">
        <span className="btn-ghost inline-flex h-11 items-center gap-2 pl-2 pr-4 text-[15px]">
          <LangIcon code="auto" size={28} />
          Auto-detect
        </span>
        <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
        <TargetPicker languages={languages} value={target} onChange={onTarget} />
        <span className="chip hidden h-8 items-center px-3 text-[13px] text-primary sm:inline-flex">
          Balanced · <span className="num mx-1">{CREDITS_PER_MINUTE_BY_QUALITY.balanced}</span> tokens / min
        </span>
        {disabled && (
          <span className="chip inline-flex h-8 items-center gap-2 px-3 text-[13px] text-danger">
            <span aria-hidden className="h-2 w-2 rounded-full bg-danger" />
            Pipeline unreachable
          </span>
        )}
        <button
          type="button"
          onClick={go}
          disabled={!ready}
          className="btn-primary focusable ml-auto inline-flex h-12 items-center gap-2 px-6 text-[15px] lg:h-14 lg:px-7 lg:text-base"
        >
          {mode === 'upload' ? 'Choose a file' : 'Start dubbing'}
          <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </motion.section>
  )
}

/* ── The balance ────────────────────────────────────────────────────────── */

/**
 * The copper card. The bars are the minutes you dubbed on each of the last
 * seven days, today in ink — so the card says both what you have and how fast
 * it has been going.
 */
function BalanceCard({ works }: { works: Work[] }) {
  const { balance, planInfo, loading } = useWallet()
  const minutes = Math.floor(affordableSeconds(balance, 'balanced') / 60)
  const days = useMemo(() => buckets(works, 'week'), [works])
  const peak = Math.max(...days.map((d) => d.minutes), 0)

  return (
    <motion.section
      aria-label="Token balance"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_ENTRANCE, delay: 0.05 }}
      className="copper-card hidden min-w-0 flex-[1_1_340px] flex-col justify-between gap-5 p-7 lg:flex"
    >
      <span aria-hidden className="glow -right-20 -top-[90px] h-[260px] w-[280px] bg-[rgb(255_236_214/0.5)]" />
      <div className="relative flex items-center justify-between gap-3">
        <span className="text-[15px] font-medium">Token balance</span>
        <span className="inline-flex h-8 items-center rounded-full border border-[rgb(20_11_5/0.2)] bg-[rgb(20_11_5/0.12)] px-3 text-[13px]">
          {planInfo.name}
        </span>
      </div>
      <div className="relative flex flex-col gap-1">
        <AnimatedNumber
          value={balance}
          className={`num text-[80px] leading-[80px] tracking-[-0.04em] ${loading ? 'opacity-40' : ''}`}
        />
        <span className="text-sm text-[rgb(20_11_5/0.78)]">
          tokens · about <span className="num">{minutes.toLocaleString()}</span> minutes at Balanced
        </span>
      </div>
      <div aria-hidden className="relative flex h-16 items-end gap-1.5">
        {days.map((d, i) => (
          <span
            key={d.label}
            className="flex-1 rounded-full"
            style={{
              height: `${peak > 0 ? Math.max((d.minutes / peak) * 100, 12) : 12}%`,
              background: i === days.length - 1 ? '#140b05' : 'rgb(20 11 5 / 0.18)',
            }}
          />
        ))}
      </div>
      <div className="relative flex gap-2">
        <Link
          to="/plans"
          className="focusable inline-flex h-11 items-center rounded-full border border-[#140b05] bg-[#140b05] px-5 text-[15px] font-medium text-[#f5f0e8] transition-opacity hover:opacity-90"
        >
          Top up
        </Link>
        <Link
          to="/plans"
          className="focusable inline-flex h-11 items-center rounded-full border border-[rgb(20_11_5/0.15)] bg-[rgb(255_255_255/0.25)] px-5 text-[15px] text-[#140b05] transition-colors hover:bg-[rgb(255_255_255/0.35)]"
        >
          Manage plan
        </Link>
      </div>
    </motion.section>
  )
}

/* ── At a glance ────────────────────────────────────────────────────────── */

function AtAGlance({
  works,
  languages,
  pipeline,
}: {
  works: Work[]
  languages: Language[]
  pipeline: 'up' | 'down' | 'checking'
}) {
  const navigate = useNavigate()
  const { balance, loading } = useWallet()
  const minutes = Math.floor(affordableSeconds(balance, 'balanced') / 60)
  const total = works.reduce((s, w) => s + (w.status === 'completed' ? (w.durationSec ?? 0) : 0), 0)
  const flags = TURKIC_ORDER.map((c) => languages.find((l) => l.code === c))
    .filter((l): l is Language => !!l)
    .slice(0, 4)

  const pipe = {
    up: { dot: 'bg-success', chip: 'Live', value: 'Online' },
    down: { dot: 'bg-danger', chip: 'Down', value: 'Offline' },
    checking: { dot: 'bg-[rgb(var(--c-text-muted))]', chip: 'Checking', value: '…' },
  }[pipeline]

  return (
    <>
      {/* Phones: one glass card, three figures. */}
      <section aria-label="At a glance" className="card grid grid-cols-3 gap-2 p-3.5 lg:hidden">
        {[
          { label: 'Minutes', value: minutes },
          { label: 'Dubs', value: works.length },
          { label: 'Languages', value: languages.length },
        ].map((s) => (
          <div key={s.label} className="inner px-3 py-2.5">
            <span className="block text-xs text-muted">{s.label}</span>
            <AnimatedNumber value={s.value} className={`num text-[26px] text-primary ${loading ? 'opacity-40' : ''}`} />
          </div>
        ))}
      </section>

      {/* Desktop: four cards. */}
      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className="hidden flex-wrap gap-4 lg:flex"
      >
        <StatCard
          icon={ICON.clock}
          accent
          chip={<>Balanced</>}
          label="Minutes left"
          value={<AnimatedNumber value={minutes} className={loading ? 'opacity-40' : ''} />}
          onClick={minutes < 5 && !loading ? () => navigate('/plans') : undefined}
          note={minutes < 5 && !loading ? 'Running low. Top up →' : undefined}
        />
        <StatCard
          icon={ICON.video}
          chip={
            <>
              <span className="num">{fmtDur(total)}</span> total
            </>
          }
          label="Dubs made"
          value={<AnimatedNumber value={works.length} />}
        />
        <StatCard
          icon={ICON.globe}
          chip={
            flags.length > 0 ? (
              <span className="flex">
                {flags.map((l, i) => (
                  <LangIcon key={l.code} code={l.code} flag={l.flag} size={24} className={i > 0 ? '-ml-2' : ''} />
                ))}
              </span>
            ) : null
          }
          bare
          label="Languages"
          value={<AnimatedNumber value={languages.length} />}
        />
        <StatCard
          icon={ICON.pulse}
          chip={
            <>
              <span aria-hidden className={`h-2 w-2 rounded-full ${pipe.dot}`} />
              {pipe.chip}
            </>
          }
          label="Pipeline"
          value={<span className="font-sans text-[32px] font-medium tracking-[-0.02em]">{pipe.value}</span>}
        />
      </motion.div>
    </>
  )
}

function StatCard({
  icon,
  accent,
  chip,
  bare,
  label,
  value,
  note,
  onClick,
}: {
  icon: string
  accent?: boolean
  chip: ReactNode
  /** Render the chip's content without the chip around it (the flag stack). */
  bare?: boolean
  label: string
  value: ReactNode
  note?: string
  onClick?: () => void
}) {
  return (
    <motion.div variants={rise} className="card flex min-w-0 flex-[1_1_220px] flex-col gap-3.5 p-6">
      <div className="flex items-center justify-between gap-2.5">
        <span data-accent={accent} className="icon-tile h-11 w-11 shrink-0 text-primary">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d={icon} />
          </svg>
        </span>
        {chip &&
          (bare ? (
            chip
          ) : (
            <span className="chip inline-flex h-[26px] items-center gap-1.5 px-3 text-xs text-primary">{chip}</span>
          ))}
      </div>
      <span className="text-[13px] text-muted">{label}</span>
      <span className="num text-[44px] leading-[44px] text-primary">{value}</span>
      {note && (
        <button type="button" onClick={onClick} className="focusable self-start text-[13px] font-medium text-brand">
          {note}
        </button>
      )}
    </motion.div>
  )
}

/* ── Minutes dubbed ─────────────────────────────────────────────────────── */

type Range = 'week' | 'month' | 'year'

/**
 * Minutes of finished dubs per day, week or month. Real data only: an account
 * with nothing dubbed yet sees empty hatched bars and says so, rather than a
 * made-up week that would look like someone else's activity.
 */
function MinutesChart({ works }: { works: Work[] }) {
  const [range, setRange] = useState<Range>('week')
  const bars = useMemo(() => buckets(works, range), [works, range])
  const peak = Math.max(...bars.map((b) => b.minutes), 0)
  const peakAt = peak > 0 ? bars.findIndex((b) => b.minutes === peak) : -1
  const top = Math.max(4, Math.ceil(peak / 4) * 4)
  const sum = bars.reduce((s, b) => s + b.minutes, 0)
  const span = { week: 'the last 7 days', month: 'the last 4 weeks', year: 'the last 12 months' }[range]

  return (
    <section aria-label="Minutes dubbed" className="card flex min-w-0 flex-[2_1_600px] flex-col gap-[18px] p-6">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-col gap-1">
          <h2 className="text-[19px] font-medium leading-6 tracking-[-0.01em] text-primary">Minutes dubbed</h2>
          <span className="text-[13px] text-muted">
            {sum > 0 ? (
              <>
                <span className="num">{fmtMin(sum)}</span> min in {span}
              </>
            ) : (
              `Nothing dubbed in ${span} yet`
            )}
          </span>
        </div>
        <div role="radiogroup" aria-label="Range" className="seg-track">
          {(['week', 'month', 'year'] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={range === r}
              data-active={range === r}
              onClick={() => setRange(r)}
              className="seg focusable"
            >
              {r === 'week' ? 'Week' : r === 'month' ? 'Month' : 'Year'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex h-[260px] gap-3.5">
        <div aria-hidden className="flex flex-col justify-between pb-[34px] text-xs text-muted">
          {[top, (top * 3) / 4, top / 2, top / 4, 0].map((t) => (
            <span key={t} className="num">
              {fmtMin(t)}
            </span>
          ))}
        </div>
        <div
          role="img"
          aria-label={`Bar chart of minutes dubbed over ${span}`}
          className="grid flex-1 gap-3.5"
          style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}
        >
          {bars.map((b, i) => {
            const hot = i === peakAt
            return (
              <div key={b.label} className="relative flex flex-col items-center gap-2.5">
                {hot && (
                  <span className="chip chip-ink num absolute -top-1.5 z-10 inline-flex h-[26px] items-center whitespace-nowrap px-3 text-xs">
                    {fmtMin(b.minutes)} min
                  </span>
                )}
                <div className="hatch flex w-full max-w-[54px] flex-1 items-end rounded-full">
                  {b.minutes > 0 && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.max((b.minutes / top) * 100, 6)}%` }}
                      transition={{ duration: 0.5, ease: EASE_ENTRANCE, delay: i * 0.03 }}
                      className={`w-full rounded-full ${hot ? 'bar-ink' : b.weekend ? 'bar-cream' : 'bar-ac'}`}
                    />
                  )}
                </div>
                <span
                  className={`chip inline-flex h-6 items-center whitespace-nowrap px-2.5 text-xs ${
                    hot ? 'chip-ink' : 'text-primary'
                  }`}
                >
                  {b.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ── Where you dub ──────────────────────────────────────────────────────── */

function WhereYouDub({
  works,
  languages,
  onDub,
}: {
  works: Work[]
  languages: Language[]
  onDub: (code: string) => void
}) {
  const { shares, pair, tried } = useMemo(() => {
    const counts = new Map<string, number>()
    const pairs = new Map<string, number>()
    for (const w of works) {
      counts.set(w.targetLang, (counts.get(w.targetLang) ?? 0) + 1)
      const p = `${w.sourceLang.toUpperCase()} → ${w.targetLang.toUpperCase()}`
      pairs.set(p, (pairs.get(p) ?? 0) + 1)
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
    return {
      shares: sorted.map(([code, n]) => ({ code, share: n / works.length })),
      pair: [...pairs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
      tried: new Set(counts.keys()),
    }
  }, [works])

  // The ring: up to three languages, then everything else as one slice.
  const COLOURS = ['var(--ac)', '#f2dcc0', 'rgb(var(--c-text-primary))', 'var(--well-edge)']
  const slices = [...shares.slice(0, 3), ...(shares.length > 3 ? [{ code: 'other', share: shares.slice(3).reduce((s, x) => s + x.share, 0) }] : [])]
  let at = 0
  const ring =
    slices.length === 0
      ? 'var(--well)'
      : `conic-gradient(${slices
          .map((s, i) => {
            const from = at
            at += s.share * 100
            return `${COLOURS[i]} ${from}% ${at}%`
          })
          .join(', ')})`

  const lead = shares[0]
  const leadLang = lead && languages.find((l) => l.code === lead.code)
  const next = TURKIC_ORDER.map((c) => languages.find((l) => l.code === c))
    .filter((l): l is Language => !!l && !tried.has(l.code))
    .slice(0, 3)

  return (
    <section aria-label="Where you dub" className="card flex min-w-0 flex-[1_1_340px] flex-col gap-[18px] p-6">
      <div className="flex items-center justify-between gap-2.5">
        <h2 className="text-[19px] font-medium leading-6 tracking-[-0.01em] text-primary">Where you dub</h2>
        <span className="chip inline-flex h-8 items-center px-3 text-[13px] text-primary">
          <span className="num mr-1">{works.length}</span> {works.length === 1 ? 'dub' : 'dubs'}
        </span>
      </div>

      <div className="flex justify-center py-1.5">
        <div
          role="img"
          aria-label={
            leadLang
              ? `${Math.round(lead.share * 100)}% of your dubs are into ${leadLang.name}`
              : 'No dubs yet'
          }
          className="relative grid h-[190px] w-[190px] place-items-center"
        >
          {/* The ring is cut out with a mask rather than covered by a disc, so
              the glass card shows through the hole. */}
          <span
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{
              background: ring,
              WebkitMaskImage: 'radial-gradient(circle, transparent 74px, #000 75px)',
              maskImage: 'radial-gradient(circle, transparent 74px, #000 75px)',
            }}
          />
          <div className="relative flex h-[150px] w-[150px] flex-col items-center justify-center gap-1">
            {leadLang ? (
              <>
                <LangIcon code={leadLang.code} flag={leadLang.flag} size={40} />
                <span className="num text-[30px] leading-9 text-primary">{Math.round(lead.share * 100)}%</span>
                <span className="text-[13px] text-muted">{leadLang.name}</span>
              </>
            ) : (
              <span className="px-6 text-center text-[13px] text-muted">Your first dub will show up here</span>
            )}
          </div>
          {pair && (
            <span className="chip chip-ink absolute -right-3.5 top-[18px] inline-flex h-7 items-center px-3 text-xs">
              {pair}
            </span>
          )}
        </div>
      </div>

      {next.length > 0 && (
        <div className="mt-auto flex flex-col gap-2">
          <span className="text-[13px] text-muted">Built for Turkic languages. Try one next:</span>
          <div className="flex flex-wrap gap-1.5">
            {next.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => onDub(l.code)}
                className="btn-ghost focusable inline-flex h-[34px] items-center gap-2 pl-1.5 pr-3.5 text-[13px]"
              >
                <LangIcon code={l.code} flag={l.flag} size={24} />
                {l.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/* ── Recent dubs ────────────────────────────────────────────────────────── */

function RecentDubs({ works }: { works: Work[] }) {
  const navigate = useNavigate()

  return (
    <section aria-label="Recent dubs" className="card flex min-w-0 flex-[2_1_600px] flex-col gap-1.5 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-2.5 pb-2.5">
        <h2 className="text-[17px] font-medium leading-6 tracking-[-0.01em] text-primary sm:text-[19px]">Recent dubs</h2>
        <Link to="/works" className="btn-ghost focusable inline-flex h-[34px] items-center gap-1.5 px-3.5 text-[13px]">
          View all
          <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17 17 7M8 7h9v9" />
          </svg>
        </Link>
      </div>

      {works.length === 0 ? (
        <div className="inner flex flex-col items-center gap-3 px-6 py-10 text-center">
          <span className="text-[15px] font-medium text-primary">No dubs yet</span>
          <span className="max-w-xs text-[13px] text-muted">Everything you dub lands here, ready to watch and download.</span>
          <button
            type="button"
            onClick={() => navigate('/studio')}
            className="btn-primary focusable mt-1 inline-flex h-[34px] items-center px-4 text-[13px]"
          >
            Open the Studio
          </button>
        </div>
      ) : (
        works.map((w) => {
          const failed = w.status === 'failed'
          const output = failed ? undefined : mediaUrl(w.outputUrl)
          return (
            <div key={w.id} className="flex items-center gap-3.5 border-b border-[var(--card-edge)] py-3 last:border-b-0 sm:py-3.5">
              <button
                type="button"
                onClick={() => navigate('/works')}
                className="focusable flex min-w-0 flex-1 items-center gap-3.5 rounded-2xl text-left"
              >
                <span className="hatch relative grid h-[50px] w-[72px] shrink-0 place-items-center overflow-hidden rounded-2xl sm:h-[60px] sm:w-24">
                  <WorkThumb work={w} />
                  <span aria-hidden className="relative grid h-9 w-9 place-items-center rounded-full bg-[rgb(var(--c-text-primary))] text-[rgb(var(--c-canvas))]">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-[15px] font-medium text-primary">{workTitle(w)}</span>
                  <span className="text-[13px] text-muted">
                    {relTime(w.createdAt)} · <span className="num">{fmtDur(w.durationSec ?? 0)}</span>
                  </span>
                </span>
              </button>
              <span className="chip hidden h-8 items-center gap-1.5 pl-1.5 pr-2 text-xs sm:inline-flex" title={workPair(w)}>
                <LangIcon code={w.sourceLang} size={20} />
                <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
                <LangIcon code={w.targetLang} size={20} />
              </span>
              <span className="chip inline-flex h-[26px] shrink-0 items-center gap-1.5 px-2.5 text-[11px] text-primary sm:h-8 sm:px-3 sm:text-[13px]">
                <span aria-hidden className={`h-2 w-2 rounded-full ${failed ? 'bg-danger' : 'bg-success'}`} />
                {failed ? 'Failed' : (
                  <>
                    <span className="sm:hidden">Done</span>
                    <span className="hidden sm:inline">Completed</span>
                  </>
                )}
              </span>
              {output && (
                <a
                  href={output}
                  download
                  aria-label={`Download ${workTitle(w)}`}
                  className="bar-icon focusable hidden h-9 w-9 sm:grid"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v12M7 10l5 5 5-5M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  </svg>
                </a>
              )}
            </div>
          )
        })
      )}
    </section>
  )
}

/* ── Quick start ────────────────────────────────────────────────────────── */

/**
 * The presets. They used to be four rows in the sidebar under an "Apps"
 * heading, which was wrong twice over: all of them opened the same screen, so
 * the nav claimed four applications where there is one, and a preset is a way
 * to START something, not a place. Here they read correctly — doors into the
 * Studio, each pre-tuned, plus the one into Text to speech.
 */
function QuickStartCard({ target }: { target: string }) {
  const navigate = useNavigate()
  const studio = (preset: string) => () => navigate('/studio', { state: { preset, targetLang: target } })
  const rows = [
    { title: 'Dub a video', sub: 'From a file or a link', icon: ICON.video, onClick: studio('video') },
    { title: 'Dub a podcast', sub: 'Audio only, studio quality', icon: ICON.podcast, onClick: studio('podcast') },
    { title: 'Clone a voice', sub: 'Keeps the original speaker', icon: ICON.voice, onClick: studio('voice') },
    { title: 'Text to speech', sub: 'Type a script, hear it', icon: ICON.type, onClick: () => navigate('/tts') },
  ]

  return (
    <section aria-label="Quick start" className="card flex min-w-0 flex-[1_1_340px] flex-col gap-2.5 p-4 sm:p-6">
      <h2 className="pb-1.5 text-[17px] font-medium leading-6 tracking-[-0.01em] text-primary sm:text-[19px]">Quick start</h2>
      {rows.map((r, i) => (
        <button
          key={r.title}
          type="button"
          onClick={r.onClick}
          className="inner focusable group flex items-center gap-3.5 rounded-full p-2 text-left transition-colors hover:border-[var(--card-edge-hover)]"
        >
          <span data-accent={i === 0} className="icon-tile h-11 w-11 shrink-0 text-primary">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d={r.icon} />
            </svg>
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-medium text-primary">{r.title}</span>
            <span className="truncate text-[13px] text-muted">{r.sub}</span>
          </span>
          <span aria-hidden className="bar-icon h-9 w-9 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17 17 7M8 7h9v9" />
            </svg>
          </span>
        </button>
      ))}
    </section>
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
        className="btn-ghost focusable inline-flex h-11 items-center gap-2 pl-2 pr-3 text-[15px]"
      >
        <LangIcon code={selected?.code ?? value} flag={selected?.flag} size={28} />
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
            className="absolute bottom-[calc(100%+0.5rem)] left-0 z-50 w-72 overflow-hidden rounded-[24px] border border-[var(--card-edge)] bg-raised p-1.5 shadow-[var(--shadow-lg)]"
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
                  className={`flex w-full items-center gap-2.5 rounded-full px-2.5 py-2 text-left text-sm transition-colors hover:bg-sunken ${
                    l.code === value ? 'bg-sunken text-primary' : 'text-secondary'
                  }`}
                >
                  <LangIcon code={l.code} flag={l.flag} size={18} />
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

function SectionHead({
  title,
  sub,
  subDesktopOnly,
}: {
  title: string
  sub?: string
  /** Drop the explainer on phones, where it costs a line and says little. */
  subDesktopOnly?: boolean
}) {
  return (
    <div className="min-w-0">
      <h2 className="text-[19px] font-medium leading-6 tracking-[-0.01em] text-primary">{title}</h2>
      {sub && (
        <p className={`mt-1 text-sm text-secondary ${subDesktopOnly ? 'hidden sm:block' : ''}`}>{sub}</p>
      )}
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
      className={`card card-hover focusable flex min-w-0 items-center gap-2.5 p-2.5 text-left sm:gap-3 sm:p-3.5 ${
        featured ? 'bg-sunken/60' : ''
      }`}
    >
      <LangIcon code={lang.code} flag={lang.flag} size={34} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-primary">{lang.native}</span>
        <span className="block truncate text-[12px] text-muted">{lang.name}</span>
      </span>
      <span className="hidden shrink-0 text-[11px] uppercase text-muted sm:inline">{lang.code}</span>
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

/** Minutes as a figure: one decimal under ten, whole above. */
function fmtMin(m: number): string {
  return m >= 10 ? Math.round(m).toString() : (Math.round(m * 10) / 10).toString()
}

interface Bucket {
  label: string
  minutes: number
  /** Saturday or Sunday, in the week view — drawn in cream. */
  weekend: boolean
}

/**
 * Minutes of COMPLETED dubs in each slot of a range, oldest first, ending with
 * the slot that contains today: seven days, four weeks, or twelve months.
 */
function buckets(works: Work[], range: Range): Bucket[] {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const slots: { start: number; end: number; label: string; weekend: boolean }[] = []

  if (range === 'week') {
    for (let i = 6; i >= 0; i--) {
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i + 1)
      const day = start.getDay()
      slots.push({
        start: start.getTime(),
        end: end.getTime(),
        label: start.toLocaleDateString('en-US', { weekday: 'short' }),
        weekend: day === 0 || day === 6,
      })
    }
  } else if (range === 'month') {
    for (let i = 3; i >= 0; i--) {
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1 - i * 7)
      const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 7)
      slots.push({
        start: start.getTime(),
        end: end.getTime(),
        label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        weekend: false,
      })
    }
  } else {
    for (let i = 11; i >= 0; i--) {
      const start = new Date(today.getFullYear(), today.getMonth() - i, 1)
      const end = new Date(today.getFullYear(), today.getMonth() - i + 1, 1)
      slots.push({
        start: start.getTime(),
        end: end.getTime(),
        label: start.toLocaleDateString('en-US', { month: 'short' }),
        weekend: false,
      })
    }
  }

  return slots.map(({ start, end, label, weekend }) => ({
    label,
    weekend,
    minutes: works.reduce(
      (sum, w) =>
        w.status === 'completed' && w.createdAt >= start && w.createdAt < end
          ? sum + (w.durationSec ?? 0) / 60
          : sum,
      0,
    ),
  }))
}

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
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  pulse: 'M22 12h-4l-3 9L9 3l-3 9H2',
  type: 'M4 7V4h16v3M9 20h6M12 4v16',
} as const
