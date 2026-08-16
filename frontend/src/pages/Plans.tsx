// Plans & billing (04).
//
// The whole page is the real billing API (NestJS, /v1/payments): prices, credit
// grants, the free-dub allowance and the per-quality tariff all come from
// GET /payments/plans, the subscription and payment rows from the user's own
// account. Checkout is a Stripe-hosted Payment Link — the API returns the URL
// (carrying this user's client_reference_id) and we hand the browser over, so
// card data never touches this origin and only the publishable key is shipped.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import Page from '../components/Page'
import AnimatedNumber from '../components/AnimatedNumber'
import Toast from '../components/Toast'
import { EASE_ENTRANCE, rise, stagger } from '../lib/motion'
import { useWallet } from '../lib/wallet'
import {
  useCancelSubscription,
  useCheckout,
  useHistory,
  usePlans,
  useSubscription,
} from '../lib/queries'
import {
  isStripeLiveMode,
  isStripeTestMode,
  stripeUnavailableReason,
} from '../lib/stripe'
import type {
  BillingCycle,
  PaymentRow,
  PlansResponse,
  PlanTier,
  ServerPlan,
  Subscription,
} from '../lib/payments-api'

type Cycle = 'weekly' | 'monthly' | 'yearly'
const CYCLES: { key: Cycle; label: string; suffix: string; api: BillingCycle }[] = [
  { key: 'weekly', label: 'Weekly', suffix: '/wk', api: 'WEEKLY' },
  { key: 'monthly', label: 'Monthly', suffix: '/mo', api: 'MONTHLY' },
  { key: 'yearly', label: 'Yearly', suffix: '/yr', api: 'YEARLY' },
]

// UI tier assembled from the server's Plan rows (one row per tier×cycle).
interface UiTier {
  tier: PlanTier
  name: string
  highlight: boolean
  features: string[]
  prices: Record<Cycle, number> // dollars
  creditsGranted: number
}

// What each tier unlocks. This is product copy, not data — the numbers beside
// it (price, credits, limits) are always read from the API.
const TIER_META: { tier: PlanTier; name: string; highlight: boolean; features: string[] }[] = [
  { tier: 'FREE', name: 'Free', highlight: false, features: ['Fast & Balanced quality', 'Voice cloning', 'Standard queue'] },
  { tier: 'PRO', name: 'Pro', highlight: true, features: ['All qualities incl. Studio', 'Voice cloning + lip sync', 'Priority queue', 'Background separation'] },
  { tier: 'STUDIO', name: 'Studio', highlight: false, features: ['Everything in Pro', 'Batch dubbing', 'Highest fidelity output', 'Email support'] },
]

function buildTiers(plans: ServerPlan[]): UiTier[] {
  return TIER_META.map((m) => {
    const priceFor = (c: Cycle): number => {
      const api = CYCLES.find((x) => x.key === c)!.api
      const row = plans.find((p) => p.tier === m.tier && p.cycle === api)
      return row ? row.priceCents / 100 : 0
    }
    const monthly = plans.find((p) => p.tier === m.tier && p.cycle === 'MONTHLY')
    return {
      tier: m.tier,
      name: m.name,
      highlight: m.highlight,
      features: m.features,
      prices: { weekly: priceFor('weekly'), monthly: priceFor('monthly'), yearly: priceFor('yearly') },
      creditsGranted: monthly?.creditsGranted ?? 0,
    }
  })
}

export default function Plans() {
  const { balance, planInfo } = useWallet()

  const plansQuery = usePlans()
  const subscriptionQuery = useSubscription()
  const historyQuery = useHistory(1, 10)
  const checkout = useCheckout()
  const cancel = useCancelSubscription()

  const [cycle, setCycle] = useState<Cycle>('monthly')
  const [showCompare, setShowCompare] = useState(false)
  const [toast, setToast] = useState<{ id: number; msg: string } | null>(null)

  const tiers = plansQuery.data ? buildTiers(plansQuery.data.plans) : []
  const subscription = subscriptionQuery.data?.subscription ?? null
  const history = historyQuery.data?.items ?? []

  const stripeBlocked = stripeUnavailableReason()

  const activeTier: PlanTier =
    subscription && subscription.status === 'ACTIVE' ? (subscription.plan?.tier ?? 'FREE') : 'FREE'
  const activeCycle = subscription?.plan?.cycle

  // Redirect to the Stripe-hosted Payment Link. Payment Links own the whole
  // checkout UI — no client-side Stripe SDK needed.
  async function startCheckout(t: UiTier) {
    if (t.tier === 'FREE' || stripeBlocked) return
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
      {isStripeTestMode && (
        <div className="rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          <strong className="font-medium">Stripe test mode.</strong> Checkout accepts test cards only — no
          money moves. Set a <code className="font-mono text-xs">pk_live_</code> key to take real payments.
        </div>
      )}
      {stripeBlocked && (
        <div className="rounded-card border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          <strong className="font-medium">Checkout is unavailable.</strong> {stripeBlocked}
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
                    disabled={!!stripeBlocked}
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
          />
        </motion.div>

        {history.length > 0 && (
          <motion.div variants={rise}>
            <HistoryCard rows={history} />
          </motion.div>
        )}

        <StripeFooter />
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
        {cycle === 'weekly' ? 'No commitment · cancel anytime' : cycle === 'yearly' ? 'Billed once a year' : 'Billed every month'}
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
  const suffix = CYCLES.find((c) => c.key === cycle)!.suffix
  const perMonthYear = cycle === 'yearly' && price > 0 ? (price / 12).toFixed(2) : null
  const isFree = tier.tier === 'FREE'

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
      variants={rise}
      whileHover={{ y: -2 }}
      className={`card relative flex flex-col p-6 ${featured ? 'border-brand/45 max-md:order-first' : ''} ${
        current ? 'ring-1 ring-brand' : ''
      }`}
    >
      <div className="flex items-center justify-between">
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
        {tier.creditsGranted.toLocaleString()} credits / month
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

      <button
        onClick={onSelect}
        disabled={current || busy || isFree || disabled}
        className={`focusable mt-6 w-full rounded-control py-3 font-mono text-sm font-medium transition-colors disabled:cursor-default ${
          current || isFree || disabled
            ? 'border border-subtle bg-sunken text-muted'
            : 'btn-primary'
        }`}
      >
        {label}
      </button>
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
  const rows: { feature: string; values: (string | boolean)[] }[] = [
    { feature: 'Credits per month', values: tiers.map((t) => t.creditsGranted.toLocaleString()) },
    { feature: 'Weekly price', values: tiers.map((t) => fmtPrice(t.prices.weekly)) },
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
}: {
  subscription: Subscription | null
  canceling: boolean
  onCancel: () => void
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

function StripeFooter() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-subtle bg-sunken/50 px-5 py-4">
      <p className="font-mono text-xs text-muted">
        Payments are processed by Stripe. Card details never reach this site, and credits are granted
        automatically once Stripe confirms the payment.
      </p>
      {isStripeLiveMode && (
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
