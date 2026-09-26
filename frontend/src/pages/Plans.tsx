// Plans & billing (04).
//
// The whole page is the real billing API (NestJS, /v1/payments): prices, credit
// grants, the free-dub allowance and the per-quality tariff all come from
// GET /payments/plans, the subscription and payment rows from the user's own
// account. Checkout is Dodo-hosted — the API opens a checkout session stamped
// with this user's id and returns its URL, and we hand the browser over, so
// card data never touches this origin and no payment key is shipped at all.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import Page from '../components/Page'
import AnimatedNumber from '../components/AnimatedNumber'
import MagneticButton from '../components/MagneticButton'
import { usePointerSpotlight } from '../hooks/usePointerSpotlight'
import Toast from '../components/Toast'
import { EASE_ENTRANCE, rise, stagger } from '../lib/motion'
import { useWallet } from '../lib/wallet'
import {
  useCancelSubscription,
  useCheckout,
  useCreditCheckout,
  useCreditPacks,
  useHistory,
  usePlans,
  useSubscription,
} from '../lib/queries'
import { checkoutUnavailableReason, isTestCheckoutUrl, unbuyablePlans } from '../lib/dodo'
import { creditsForMinutes, getCustomerPortalUrl, packFor } from '../lib/payments-api'
import type {
  BillingCycle,
  CheckoutInfo,
  CreditPack,
  CreditPacksResponse,
  PaymentRow,
  PlansResponse,
  PlanTier,
  ServerPlan,
  Subscription,
} from '../lib/payments-api'

// Weekly billing is no longer sold. The API still knows the cycle (existing
// weekly subscribers keep renewing, and the subscription card below prints
// whatever cycle their row carries) — it is simply not offered to new buyers.
type Cycle = 'monthly' | 'yearly'
const CYCLES: { key: Cycle; label: string; suffix: string; per: string; api: BillingCycle }[] = [
  { key: 'monthly', label: 'Monthly', suffix: '/mo', per: 'month', api: 'MONTHLY' },
  { key: 'yearly', label: 'Yearly', suffix: '/yr', per: 'year', api: 'YEARLY' },
]

// UI tier assembled from the server's Plan rows (one row per tier×cycle).
interface UiTier {
  tier: PlanTier
  name: string
  highlight: boolean
  features: string[]
  prices: Record<Cycle, number> // dollars
  /** Credits the whole billing period is worth, per cycle. */
  credits: Record<Cycle, number>
  /** Credits in one allocation — differs from `credits` only for yearly. */
  perGrant: Record<Cycle, number>
  /** Allocations per period: 1 for weekly/monthly, 12 for yearly. */
  grants: Record<Cycle, number>
  /**
   * Set when the tier exists at exactly one cycle (FREE, which is only sold
   * monthly). Its credits are quoted against this rather than whatever the
   * cycle switch says, so Free never reads as "60 credits / year".
   */
  fixedCycle?: Cycle
}

// What each tier unlocks. This is product copy, not data — the numbers beside
// it (price, credits, limits) are always read from the API.
const TIER_META: { tier: PlanTier; name: string; highlight: boolean; features: string[] }[] = [
  { tier: 'FREE', name: 'Free', highlight: false, features: ['Fast & Balanced quality', 'Voice cloning', 'Standard queue'] },
  { tier: 'PRO', name: 'Pro', highlight: true, features: ['All qualities incl. Studio', 'Voice cloning + lip sync', 'Priority queue', 'Background separation'] },
  { tier: 'STUDIO', name: 'Studio', highlight: false, features: ['Everything in Pro', 'Batch dubbing', 'Highest fidelity output', 'Email support'] },
]

const CYCLE_KEYS: Cycle[] = ['monthly', 'yearly']

function byCycle<T>(pick: (c: Cycle) => T): Record<Cycle, T> {
  return { monthly: pick('monthly'), yearly: pick('yearly') }
}

/**
 * Credit figures for one plan row, from whatever the server actually sent.
 *
 * Deliberately paranoid about missing and non-numeric fields: an API deployed
 * before `grantsPerPeriod` existed omits it, and `creditsGranted * undefined`
 * is NaN — which then propagates through toLocaleString() and puts "NaN
 * credits / month" on every pricing card. A number the user reads as a promise
 * about what they are buying must degrade to a real number, never to NaN.
 * `Number(x) || fallback` catches undefined, null and NaN in one step.
 */
function creditsOf(row: ServerPlan | undefined): {
  perGrant: number
  grants: number
  total: number
} {
  const perGrant = Number(row?.creditsGranted) || 0
  const grants = Number(row?.grantsPerPeriod) || 1
  return { perGrant, grants, total: perGrant * grants }
}

function buildTiers(plans: ServerPlan[]): UiTier[] {
  return TIER_META.map((m) => {
    // FREE only has a MONTHLY row — there is nothing to buy weekly or yearly —
    // so fall back to it and the tier still renders under every switch.
    const rowFor = (c: Cycle): ServerPlan | undefined => {
      const api = CYCLES.find((x) => x.key === c)!.api
      return (
        plans.find((p) => p.tier === m.tier && p.cycle === api) ??
        (m.tier === 'FREE'
          ? plans.find((p) => p.tier === 'FREE' && p.cycle === 'MONTHLY')
          : undefined)
      )
    }

    return {
      tier: m.tier,
      name: m.name,
      highlight: m.highlight,
      features: m.features,
      prices: byCycle((c) => (Number(rowFor(c)?.priceCents) || 0) / 100),
      // Every cycle reads its OWN plan row. Reading the monthly row for all
      // three was why weekly, monthly and yearly all advertised the same
      // number of credits.
      perGrant: byCycle((c) => creditsOf(rowFor(c)).perGrant),
      grants: byCycle((c) => creditsOf(rowFor(c)).grants),
      credits: byCycle((c) => creditsOf(rowFor(c)).total),
      fixedCycle: m.tier === 'FREE' ? ('monthly' as Cycle) : undefined,
    }
  })
}

export default function Plans() {
  const { balance, planInfo } = useWallet()

  const plansQuery = usePlans()
  const packsQuery = useCreditPacks()
  const subscriptionQuery = useSubscription()
  const historyQuery = useHistory(1, 10)
  const checkout = useCheckout()
  const creditCheckout = useCreditCheckout()
  const cancel = useCancelSubscription()

  const [cycle, setCycle] = useState<Cycle>('monthly')
  const [showCompare, setShowCompare] = useState(false)
  const [toast, setToast] = useState<{ id: number; msg: string } | null>(null)
  const [portalBusy, setPortalBusy] = useState(false)

  const tiers = plansQuery.data ? buildTiers(plansQuery.data.plans) : []
  const subscription = subscriptionQuery.data?.subscription ?? null
  const history = historyQuery.data?.items ?? []

  // Whether money can move is the server's answer, not a guess from a
  // build-time key: only the API knows which Dodo products are configured and
  // whether the webhook that grants the credits is wired up at all.
  const checkoutInfo: CheckoutInfo | undefined = plansQuery.data?.checkout
  const checkoutBlocked = checkoutUnavailableReason(checkoutInfo)
  const missingProducts = unbuyablePlans(checkoutInfo)

  // A configured payment link keeps whichever host it was copied from, so a
  // live-mode API can still be handing out test links. Say so when they
  // disagree rather than printing a confident badge over the wrong one.
  const linkIsTest = (plansQuery.data?.plans ?? []).some((p) =>
    isTestCheckoutUrl(p.dodoLinkUrl),
  )
  const inTestCheckout = checkoutInfo?.mode === 'test' || linkIsTest
  const modeMismatch = checkoutInfo?.mode === 'live' && linkIsTest

  const activeTier: PlanTier =
    subscription && subscription.status === 'ACTIVE' ? (subscription.plan?.tier ?? 'FREE') : 'FREE'
  const activeCycle = subscription?.plan?.cycle

  // Hand the browser to Dodo's hosted checkout. Dodo owns the whole payment
  // UI — there is no client-side SDK to load.
  async function startCheckout(t: UiTier) {
    if (t.tier === 'FREE' || checkoutBlocked) return
    try {
      const api = CYCLES.find((c) => c.key === cycle)!.api
      const { url } = await checkout.mutateAsync({
        tier: t.tier as Exclude<PlanTier, 'FREE'>,
        cycle: api,
      })
      window.location.href = url
    } catch (e) {
      setToast({ id: Date.now(), msg: e instanceof Error ? e.message : 'Could not start checkout' })
    }
  }

  // One-time pack purchase. Same handover as a subscription — the API returns
  // a Dodo-hosted URL and the browser goes there — so card data never touches
  // this origin. A pack with no Dodo product configured surfaces as a toast
  // rather than a silent no-op.
  async function buyCredits(packId: string) {
    if (checkoutBlocked) return
    try {
      const { url } = await creditCheckout.mutateAsync({ packId })
      window.location.href = url
    } catch (e) {
      setToast({
        id: Date.now(),
        msg: e instanceof Error ? e.message : 'Could not start checkout',
      })
    }
  }

  // Dodo's own portal, in a new tab: the user is mid-session here and should
  // come back to it, not lose the page to an external redirect.
  async function openPortal() {
    if (portalBusy) return
    setPortalBusy(true)
    try {
      const { url } = await getCustomerPortalUrl()
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setToast({
        id: Date.now(),
        msg: e instanceof Error ? e.message : 'Could not open the billing portal',
      })
    } finally {
      setPortalBusy(false)
    }
  }

  async function onCancel() {
    try {
      const res = await cancel.mutateAsync()
      setToast({ id: Date.now(), msg: res.message })
    } catch (e) {
      setToast({ id: Date.now(), msg: e instanceof Error ? e.message : 'Could not cancel' })
    }
  }

  function isCurrent(t: UiTier): boolean {
    if (t.tier === 'FREE') return activeTier === 'FREE'
    const api = CYCLES.find((c) => c.key === cycle)!.api
    return t.tier === activeTier && activeCycle === api
  }

  return (
    <Page className="space-y-8 pb-4">
      {/* A test-mode build takes fake cards and grants real credits in your
          database. Never let that be a surprise. */}
      {inTestCheckout && (
        <div className="rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          <strong className="font-medium">Dodo Payments test mode.</strong> Checkout accepts test cards
          only — no money moves. Set{' '}
          <code className="font-mono text-xs">DODO_PAYMENTS_ENVIRONMENT=live_mode</code> on the API, with
          live products, to take real payments.
          {modeMismatch && (
            <>
              {' '}
              <strong className="font-medium">The API is in live mode but some products are test
              links</strong> — one of the two is wrong.
            </>
          )}
        </div>
      )}
      {checkoutBlocked && (
        <div className="rounded-card border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          <strong className="font-medium">Checkout is unavailable.</strong> {checkoutBlocked}
        </div>
      )}
      {/* Some plans buyable, others not: say which, so the disabled button on
          one card is explained instead of reading as a bug. */}
      {!checkoutBlocked && missingProducts.length > 0 && (
        <div className="rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          <strong className="font-medium">Not every plan is on sale yet.</strong> No Dodo product is
          configured for {missingProducts.join(', ')}.
        </div>
      )}

      {/* ── SECTION A · Subscriptions ──────────────────────────────────── */}
      <motion.section initial="hidden" animate="show" className="space-y-6">
        <motion.div variants={rise}>
          <CycleSwitch cycle={cycle} onChange={setCycle} />
        </motion.div>

        {plansQuery.isError ? (
          <div className="card grid min-h-[200px] place-items-center p-8 text-center">
            <div>
              <div className="font-mono text-base font-medium text-primary">Couldn't load plans</div>
              <p className="mx-auto mt-1.5 max-w-xs text-sm text-secondary">
                {plansQuery.error instanceof Error ? plansQuery.error.message : 'The billing API did not respond.'}
              </p>
              <button onClick={() => void plansQuery.refetch()} className="btn-ghost focusable mt-4 px-5 py-2 font-mono text-sm">
                Retry
              </button>
            </div>
          </div>
        ) : (
          <motion.div variants={stagger} className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {tiers.length === 0
              ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="card shimmer h-96" />)
              : tiers.map((t) => (
                  <TierCard
                    key={t.tier}
                    tier={t}
                    cycle={cycle}
                    current={isCurrent(t)}
                    busy={checkout.isPending && checkout.variables?.tier === t.tier}
                    disabled={!!checkoutBlocked}
                    onSelect={() => void startCheckout(t)}
                  />
                ))}
          </motion.div>
        )}

        {plansQuery.data && (
          <motion.div variants={rise}>
            <CompareDisclosure
              open={showCompare}
              onToggle={() => setShowCompare((v) => !v)}
              tiers={tiers}
              catalog={plansQuery.data}
            />
          </motion.div>
        )}
      </motion.section>

      {/* ── SECTION A2 · One-time credits ──────────────────────────────── */}
      <motion.section initial="hidden" animate="show">
        <motion.div variants={rise}>
          <TopUpSection
            catalog={packsQuery.data}
            busyPackId={creditCheckout.isPending ? (creditCheckout.variables?.packId ?? null) : null}
            disabled={!!checkoutBlocked}
            onBuy={(packId) => void buyCredits(packId)}
          />
        </motion.div>
      </motion.section>

      {/* ── SECTION B · Balance, subscription & history ─────────────────── */}
      <motion.section initial="hidden" animate="show" className="space-y-6">
        <motion.div variants={rise}>
          <BalanceCard balance={balance} allowance={planInfo.creditsGranted} planName={planInfo.name} />
        </motion.div>

        <motion.div variants={rise}>
          <SubscriptionCard
            subscription={subscription}
            canceling={cancel.isPending}
            onCancel={() => void onCancel()}
            onManage={() => void openPortal()}
            openingPortal={portalBusy}
          />
        </motion.div>

        {history.length > 0 && (
          <motion.div variants={rise}>
            <HistoryCard rows={history} />
          </motion.div>
        )}

        <CheckoutFooter live={checkoutInfo?.mode === 'live' && !linkIsTest} />
      </motion.section>

      <AnimatePresence>
        {toast && <Toast key={toast.id} message={toast.msg} onDone={() => setToast(null)} />}
      </AnimatePresence>
    </Page>
  )
}

/* ── Cycle switcher ─────────────────────────────────────────────────────── */

function CycleSwitch({ cycle, onChange }: { cycle: Cycle; onChange: (c: Cycle) => void }) {
  return (
    <div className="mx-auto w-full max-w-[420px]">
      <LayoutGroup id="cycle">
        <div className="flex rounded-control border border-subtle bg-sunken p-1">
          {CYCLES.map((c) => (
            <button
              key={c.key}
              onClick={() => onChange(c.key)}
              className="focusable relative flex-1 rounded-[8px] px-3 py-2 text-center"
            >
              {cycle === c.key && (
                <motion.span
                  layoutId="cycle-pill"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  className="absolute inset-0 rounded-[8px] bg-brand/15 shadow-[inset_0_0_0_1px_rgb(var(--c-brand-500)/0.4)]"
                />
              )}
              <span className={`relative z-10 flex items-center justify-center gap-1.5 font-mono text-xs font-medium ${cycle === c.key ? 'text-brand' : 'text-muted hover:text-secondary'}`}>
                {c.label}
              </span>
            </button>
          ))}
        </div>
      </LayoutGroup>
      <p className="mt-1.5 text-center font-mono text-[10px] text-muted">
        {cycle === 'yearly' ? 'Billed once a year' : 'Billed every month · cancel anytime'}
      </p>
    </div>
  )
}

/* ── Tier card ──────────────────────────────────────────────────────────── */

function TierCard({
  tier,
  cycle,
  current,
  busy,
  disabled,
  onSelect,
}: {
  tier: UiTier
  cycle: Cycle
  current: boolean
  busy: boolean
  disabled: boolean
  onSelect: () => void
}) {
  const featured = tier.highlight
  const price = tier.prices[cycle]
  const meta = CYCLES.find((c) => c.key === cycle)!
  const suffix = meta.suffix
  const perMonthYear = cycle === 'yearly' && price > 0 ? (price / 12).toFixed(2) : null
  const isFree = tier.tier === 'FREE'

  // Yearly is billed once but the credits arrive a month at a time, so show
  // both numbers — the headline total and what actually lands each month.
  const creditCycle = tier.fixedCycle ?? cycle
  const creditPer = CYCLES.find((c) => c.key === creditCycle)!.per
  const grants = tier.grants[creditCycle]
  const dripNote =
    grants > 1 ? `${tier.perGrant[creditCycle].toLocaleString()} credits added every month` : null

  const spot = usePointerSpotlight<HTMLDivElement>()
  const label = current
    ? 'Current plan'
    : busy
      ? 'Redirecting…'
      : isFree
        ? 'Free plan'
        : disabled
          ? 'Unavailable'
          : `Choose ${tier.name}`

  return (
    <motion.div
      ref={spot.ref}
      onPointerEnter={spot.onPointerEnter}
      onPointerMove={spot.onPointerMove}
      variants={rise}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      className={`card spotlight sheen relative flex flex-col p-6 ${featured ? 'border-brand/45 max-md:order-first' : ''} ${
        current ? 'ring-1 ring-brand' : ''
      }`}
    >
      <div className="above flex items-center justify-between">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{tier.name}</span>
        {featured && (
          <span className="rounded-pill bg-brand/12 px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-brand">
            Popular
          </span>
        )}
      </div>

      <div className="mt-4 flex items-baseline gap-1">
        <span className="font-mono text-4xl font-medium text-primary">
          $<AnimatedNumber value={price} />
        </span>
        <span className="font-mono text-sm text-muted">{suffix}</span>
      </div>
      <div className="h-4">
        <AnimatePresence mode="wait">
          {perMonthYear && (
            <motion.p
              key={perMonthYear}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.25 }}
              className="font-mono text-[11px] text-muted"
            >
              ${perMonthYear} / month billed yearly
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-3 text-sm text-secondary">
        <span className="font-mono text-primary">{tier.credits[creditCycle].toLocaleString()}</span>{' '}
        credits / {creditPer}
      </div>
      <div className="h-4">
        {dripNote && <p className="font-mono text-[11px] text-muted">{dripNote}</p>}
      </div>

      <div className="mt-5 flex-1">
        <ul className="space-y-2.5">
          {tier.features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm text-secondary">
              <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-brand" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              {f}
            </li>
          ))}
        </ul>
      </div>

      <MagneticButton
        onClick={onSelect}
        disabled={current || busy || isFree || disabled}
        className={`focusable above mt-6 w-full rounded-control py-3 font-mono text-sm font-medium transition-colors disabled:cursor-default ${
          current || isFree || disabled
            ? 'border border-subtle bg-sunken text-muted'
            : 'btn-primary'
        }`}
      >
        {label}
      </MagneticButton>
    </motion.div>
  )
}

/* ── Pay as you go ──────────────────────────────────────────────────────── */

const EST_QUALITIES = [
  { key: 'fast', label: 'Fast' },
  { key: 'balanced', label: 'Balanced' },
  { key: 'studio', label: 'Studio' },
]

/**
 * Credits bought outright, for the person who has one video and no interest in
 * a subscription.
 *
 * The estimator is the point of the section: "how long is your clip" answers
 * "how many credits" answers "which pack", in one motion. A pack alone means
 * nothing to someone who has never bought credits before — 240 of something is
 * not a quantity anyone can picture.
 */
function TopUpSection({
  catalog,
  busyPackId,
  disabled,
  onBuy,
}: {
  catalog: CreditPacksResponse | undefined
  busyPackId: string | null
  disabled: boolean
  onBuy: (packId: string) => void
}) {
  const [minutes, setMinutes] = useState(4.5)
  const [quality, setQuality] = useState('balanced')

  if (!catalog) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="card shimmer h-72" />
        <div className="card shimmer h-72" />
      </div>
    )
  }

  const needed = creditsForMinutes(minutes, quality, catalog)
  const recommended = packFor(needed, catalog.packs)
  const packs = [...catalog.packs].sort((a, b) => a.credits - b.credits)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionMark>Pay as you go</SectionMark>
          <h2 className="mt-1.5 font-mono text-lg font-medium text-primary">
            Buy credits once — no subscription
          </h2>
          <p className="mt-1 text-sm text-secondary">
            Credits never expire and work on any quality. Pay for the video you have.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        {/* Estimator */}
        <div className="card flex flex-col p-6">
          <SectionMark>How many do I need?</SectionMark>

          <div className="mt-4 flex items-baseline gap-1.5">
            <span className="font-mono text-4xl font-medium text-primary">
              {fmtMinutes(minutes)}
            </span>
            <span className="font-mono text-sm text-muted">min of video</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={60}
            step={0.5}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            aria-label="Length of your clip in minutes"
            className="calc-slider focusable mt-3 h-11 w-full cursor-pointer"
          />
          <div className="-mt-1 flex justify-between font-mono text-[10px] text-muted">
            <span>30s</span>
            <span>60 min</span>
          </div>

          <div className="mt-4 flex rounded-control border border-subtle bg-sunken p-1">
            {EST_QUALITIES.map((q) => (
              <button
                key={q.key}
                onClick={() => setQuality(q.key)}
                className="focusable relative flex-1 rounded-[8px] px-3 py-2 font-mono text-xs font-medium transition-colors"
              >
                {quality === q.key && (
                  <motion.span
                    layoutId="est-quality-pill"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    className="absolute inset-0 rounded-[8px] bg-brand/15 shadow-[inset_0_0_0_1px_rgb(var(--c-brand-500)/0.4)]"
                  />
                )}
                <span className={`relative z-10 ${quality === q.key ? 'text-brand' : 'text-muted hover:text-secondary'}`}>
                  {q.label}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-5 border-t border-subtle pt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-secondary">You need about</span>
              <span className="font-mono text-2xl font-medium text-brand">
                <AnimatedNumber value={needed} /> <span className="text-sm text-muted">credits</span>
              </span>
            </div>
            {recommended && (
              <p className="mt-1.5 font-mono text-[11px] text-muted">
                Covered by the {recommended.credits.toLocaleString()}-credit pack ·{' '}
                {fmtCents(recommended.priceCents, recommended.currency)}
              </p>
            )}
          </div>

          {recommended && (
            <button
              onClick={() => onBuy(recommended.id)}
              disabled={disabled || busyPackId !== null}
              className="btn-primary focusable mt-4 w-full py-3 font-mono text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busyPackId === recommended.id
                ? 'Redirecting…'
                : disabled
                  ? 'Checkout unavailable'
                  : `Buy ${recommended.credits.toLocaleString()} credits · ${fmtCents(recommended.priceCents, recommended.currency)} →`}
            </button>
          )}
        </div>

        {/* Packs */}
        <div className="grid gap-4 sm:grid-cols-2">
          {packs.map((p) => (
            <PackCard
              key={p.id}
              pack={p}
              minutes={p.credits / catalog.creditsPerMinute}
              recommended={recommended?.id === p.id}
              busy={busyPackId === p.id}
              // `available === false` is the server saying it has no Dodo
              // product for this pack. Undefined means the fallback catalog,
              // which knows nothing either way — don't disable on that.
              disabled={disabled || busyPackId !== null || p.available === false}
              unavailable={p.available === false}
              onBuy={() => onBuy(p.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function PackCard({
  pack,
  minutes,
  recommended,
  busy,
  disabled,
  unavailable,
  onBuy,
}: {
  pack: CreditPack
  minutes: number
  recommended: boolean
  busy: boolean
  disabled: boolean
  /** No Dodo product configured for this pack — the price is real, the button isn't. */
  unavailable?: boolean
  onBuy: () => void
}) {
  const spot = usePointerSpotlight<HTMLDivElement>()
  const perCredit = pack.priceCents / 100 / pack.credits
  return (
    <motion.div
      ref={spot.ref}
      onPointerEnter={spot.onPointerEnter}
      onPointerMove={spot.onPointerMove}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      className={`card spotlight sheen relative flex flex-col p-5 ${
        recommended ? 'border-brand/45 ring-1 ring-brand/40' : ''
      }`}
    >
      {recommended && (
        <span className="absolute -top-2 left-5 rounded-pill bg-brand px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-canvas">
          Your pick
        </span>
      )}
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-2xl font-medium text-primary">
          {pack.credits.toLocaleString()}
        </span>
        <span className="font-mono text-xs text-muted">credits</span>
      </div>
      <div className="mt-1 font-mono text-[11px] text-muted">
        ≈ {minutes.toFixed(1)} min at Balanced
      </div>

      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="font-mono text-xl font-medium text-primary">
          {fmtCents(pack.priceCents, pack.currency)}
        </span>
        <span className="font-mono text-[11px] text-muted">
          · ${perCredit.toFixed(3)} / credit
        </span>
      </div>

      <MagneticButton
        onClick={onBuy}
        disabled={disabled}
        className={`focusable above mt-4 w-full rounded-control py-2.5 font-mono text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          recommended ? 'btn-primary' : 'btn-ghost'
        }`}
      >
        {busy ? 'Redirecting…' : unavailable ? 'Not available yet' : 'Buy credits'}
      </MagneticButton>
    </motion.div>
  )
}

/* ── Comparison disclosure ──────────────────────────────────────────────── */

/**
 * Built entirely from the API response — prices, grants, the free-dub cap and
 * the per-quality tariff. It replaced a hand-written feature matrix that could
 * (and did) drift away from what the server actually charges.
 */
function CompareDisclosure({
  open,
  onToggle,
  tiers,
  catalog,
}: {
  open: boolean
  onToggle: () => void
  tiers: UiTier[]
  catalog: PlansResponse
}) {
  // One credits row per cycle: the three grants genuinely differ, and a single
  // "credits per month" row could only ever be right for one of them.
  const rows: { feature: string; values: (string | boolean)[] }[] = [
    ...CYCLE_KEYS.map((c) => ({
      feature: `Credits · ${CYCLES.find((x) => x.key === c)!.label.toLowerCase()}`,
      values: tiers.map((t) =>
        (t.fixedCycle && t.fixedCycle !== c) || t.credits[c] === 0
          ? '–'
          : t.credits[c].toLocaleString(),
      ),
    })),
    { feature: 'Monthly price', values: tiers.map((t) => fmtPrice(t.prices.monthly)) },
    { feature: 'Yearly price', values: tiers.map((t) => fmtPrice(t.prices.yearly)) },
    ...TIER_META[1].features.map((f) => ({
      feature: f,
      values: tiers.map((t) => t.features.includes(f) || t.tier === 'STUDIO'),
    })),
  ]

  return (
    <div className="card overflow-hidden p-0">
      <button onClick={onToggle} className="focusable flex w-full items-center justify-between px-5 py-4 text-left">
        <span className="font-mono text-sm font-medium text-primary">Compare all plans</span>
        <motion.svg
          viewBox="0 0 24 24" className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.25 }}
        >
          <path d="m6 9 6 6 6-6" />
        </motion.svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE_ENTRANCE }}
            className="overflow-hidden"
          >
            <div className="overflow-x-auto px-5 pb-5">
              <table className="w-full min-w-[520px] border-collapse">
                <thead>
                  <tr className="border-b border-subtle">
                    <th className="py-2 text-left font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">Feature</th>
                    {tiers.map((t) => (
                      <th
                        key={t.tier}
                        className={`py-2 text-center font-mono text-[10px] font-medium uppercase tracking-[0.12em] ${
                          t.highlight ? 'bg-brand/[0.05] text-brand' : 'text-muted'
                        }`}
                      >
                        {t.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.feature} className="border-b border-subtle last:border-0">
                      <td className="py-2.5 text-sm text-secondary">{row.feature}</td>
                      {row.values.map((v, i) => (
                        <CompareCell key={tiers[i].tier} v={v} tinted={tiers[i].highlight} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Everything below is the live tariff the credit gate enforces. */}
              <div className="mt-5 grid gap-4 border-t border-subtle pt-4 sm:grid-cols-2">
                <div>
                  <SectionMark>Credit cost per dub</SectionMark>
                  <ul className="mt-2 space-y-1">
                    {Object.entries(catalog.qualityCost).map(([quality, cost]) => (
                      <li key={quality} className="flex items-center justify-between text-sm">
                        <span className="capitalize text-secondary">{quality}</span>
                        <span className="font-mono text-primary">{cost} credits</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <SectionMark>Free dub</SectionMark>
                  <p className="mt-2 text-sm text-secondary">
                    Every account gets one free dub of up to{' '}
                    <span className="font-mono text-primary">{Math.round(catalog.freeDubMaxSeconds / 60)} min</span>,
                    charged at zero credits.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CompareCell({ v, tinted }: { v: boolean | string; tinted?: boolean }) {
  return (
    <td className={`py-2.5 text-center ${tinted ? 'bg-brand/[0.05]' : ''}`}>
      {typeof v === 'string' ? (
        <span className="font-mono text-xs text-primary">{v}</span>
      ) : v ? (
        <svg viewBox="0 0 24 24" className="mx-auto h-4 w-4 text-success" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      ) : (
        <span className="text-muted">–</span>
      )}
    </td>
  )
}

/* ── Balance card ───────────────────────────────────────────────────────── */

function BalanceCard({
  balance,
  allowance,
  planName,
}: {
  balance: number
  allowance: number
  planName: string
}) {
  const pct = allowance > 0 ? Math.min(1, balance / allowance) : 1
  return (
    <div className="card flex flex-wrap items-center justify-between gap-6 p-6">
      <div className="relative">
        <SectionMark>Your balance</SectionMark>
        <div className="mt-2 flex items-baseline gap-2">
          <AnimatedNumber value={balance} className="font-mono text-4xl font-medium text-primary" />
          <span className="font-mono text-sm text-muted">credits</span>
        </div>
        <div className="mt-1 font-mono text-[11px] text-muted">{planName} plan</div>
      </div>

      {allowance > 0 && <BalanceRing pct={pct} balance={balance} allowance={allowance} />}
    </div>
  )
}

function BalanceRing({ pct, balance, allowance }: { pct: number; balance: number; allowance: number }) {
  const r = 34
  const c = 2 * Math.PI * r
  return (
    <div className="relative grid h-24 w-24 shrink-0 place-items-center">
      <svg viewBox="0 0 84 84" className="h-24 w-24 -rotate-90">
        <circle cx="42" cy="42" r={r} fill="none" stroke="rgb(var(--c-border-subtle))" strokeWidth="6" />
        <motion.circle
          cx="42" cy="42" r={r} fill="none" stroke="rgb(var(--c-brand-500))" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 0.6, ease: EASE_ENTRANCE }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-mono text-sm font-medium text-primary">{Math.round(pct * 100)}%</div>
        <div className="font-mono text-[9px] text-muted">{balance.toLocaleString()}/{allowance.toLocaleString()}</div>
      </div>
    </div>
  )
}

/* ── Subscription status ────────────────────────────────────────────────── */

function SubscriptionCard({
  subscription,
  canceling,
  onCancel,
  onManage,
  openingPortal,
}: {
  subscription: Subscription | null
  canceling: boolean
  onCancel: () => void
  onManage: () => void
  openingPortal: boolean
}) {
  if (!subscription || subscription.status === 'CANCELED' || subscription.status === 'EXPIRED') {
    return (
      <div className="card p-6">
        <SectionMark>Subscription</SectionMark>
        <p className="mt-2 text-sm text-secondary">
          You're on the Free plan. Choose Pro or Studio above to add monthly credits.
        </p>
      </div>
    )
  }

  const tier = subscription.plan?.tier ?? 'PRO'
  const cycle = subscription.plan?.cycle ?? 'MONTHLY'
  const renews = new Date(subscription.currentPeriodEnd)
  const renewText = subscription.cancelAtPeriodEnd
    ? `Ends ${renews.toLocaleDateString()}`
    : `Renews ${renews.toLocaleDateString()}`

  return (
    <div className="card flex flex-wrap items-center justify-between gap-4 p-6">
      <div>
        <SectionMark>Subscription</SectionMark>
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-lg font-medium text-primary">
            {tier} · {cycle}
          </span>
          <StatusPill status={subscription.status} cancelAtPeriodEnd={subscription.cancelAtPeriodEnd} />
        </div>
        <div className="mt-1 font-mono text-[11px] text-muted">{renewText}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Invoices and the card on file live with Dodo, not here — there is
            nothing to gain from rebuilding that surface, and a receipt the
            merchant of record issued is the one a customer needs. */}
        <button
          onClick={onManage}
          disabled={openingPortal}
          className="focusable rounded-control border border-subtle bg-sunken px-4 py-2 font-mono text-xs text-secondary hover:text-primary disabled:opacity-60"
        >
          {openingPortal ? 'Opening…' : 'Invoices & payment method'}
        </button>

        {!subscription.cancelAtPeriodEnd && (
          <button
            onClick={onCancel}
            disabled={canceling}
            className="focusable rounded-control border border-subtle bg-sunken px-4 py-2 font-mono text-xs text-secondary hover:text-primary disabled:opacity-60"
          >
            {canceling ? 'Canceling…' : 'Cancel subscription'}
          </button>
        )}
      </div>
    </div>
  )
}

function StatusPill({ status, cancelAtPeriodEnd }: { status: string; cancelAtPeriodEnd: boolean }) {
  const [label, cls] = cancelAtPeriodEnd
    ? ['Canceling', 'bg-warn/15 text-warn']
    : status === 'ACTIVE'
      ? ['Active', 'bg-success/15 text-success']
      : status === 'PAST_DUE'
        ? ['Past due', 'bg-danger/15 text-danger']
        : [status, 'bg-sunken text-muted']
  return <span className={`rounded-pill px-2 py-0.5 font-mono text-[10px] font-medium ${cls}`}>{label}</span>
}

/* ── Payment history ────────────────────────────────────────────────────── */

function HistoryCard({ rows }: { rows: PaymentRow[] }) {
  return (
    <div className="card p-6">
      <SectionMark>Payment history</SectionMark>
      <ul className="mt-3 divide-y divide-subtle">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between py-2.5">
            <div>
              <div className="text-sm text-secondary">{r.description}</div>
              <div className="font-mono text-[11px] text-muted">{new Date(r.createdAt).toLocaleDateString()}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm text-primary">
                {(r.amountCents / 100).toLocaleString(undefined, { style: 'currency', currency: r.currency || 'USD' })}
              </span>
              <span className={`rounded-pill px-2 py-0.5 font-mono text-[10px] ${r.status === 'SUCCEEDED' ? 'bg-success/15 text-success' : 'bg-sunken text-muted'}`}>
                {r.status}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── Small pieces ───────────────────────────────────────────────────────── */

// `live` is deliberately the AND of the API's mode and the configured links:
// the badge is a claim that real money moves, so anything less than both
// agreeing must not show it.
function CheckoutFooter({ live }: { live: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-subtle bg-sunken/50 px-5 py-4">
      <p className="font-mono text-xs text-muted">
        Payments are processed by Dodo Payments, our merchant of record. Card details never reach this
        site, and credits are granted automatically once Dodo confirms the payment.
      </p>
      {live && (
        <span className="shrink-0 rounded-pill bg-success/12 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-success">
          Live payments
        </span>
      )}
    </div>
  )
}

function SectionMark({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">/ {children}</span>
}

function fmtPrice(dollars: number): string {
  return dollars === 0 ? 'Free' : `$${dollars.toLocaleString()}`
}

// Pinned to en-US on purpose: the catalog is priced in dollars, and letting the
// visitor's locale format it turns $13.45 into "US$13.45" for a large slice of
// the world — a different-looking price for the same charge.
function fmtCents(cents: number, currency = 'usd'): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
  })
}

/** "4.5", "5", "0.5" — never "5.0". */
function fmtMinutes(m: number): string {
  return Number.isInteger(m) ? String(m) : m.toFixed(1)
}
