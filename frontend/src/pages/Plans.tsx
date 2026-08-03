import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AnimatePresence,
  LayoutGroup,
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
} from 'framer-motion'
import Page from '../components/Page'
import AnimatedNumber from '../components/AnimatedNumber'
import Toast from '../components/Toast'
import { EASE_ENTRANCE, rise, stagger } from '../lib/motion'
import { useWallet } from '../lib/wallet'
import type { PlanId } from '../lib/wallet'
import {
  getPlans,
  getCheckoutUrl,
  getSubscription,
  getHistory,
  cancelSubscription,
  type ServerPlan,
  type Subscription,
  type PaymentRow,
  type BillingCycle,
  type PlanTier,
} from '../lib/payments-api'
import { COMPARISON } from '../mocks/plans'

type Cycle = 'weekly' | 'monthly' | 'yearly'
const CYCLES: { key: Cycle; label: string; suffix: string; api: BillingCycle }[] = [
  { key: 'weekly', label: 'Weekly', suffix: '/wk', api: 'WEEKLY' },
  { key: 'monthly', label: 'Monthly', suffix: '/mo', api: 'MONTHLY' },
  { key: 'yearly', label: 'Yearly', suffix: '/yr', api: 'YEARLY' },
]

// UI tier assembled from the server's Plan rows (one row per tier×cycle).
interface UiTier {
  tier: PlanTier
  id: PlanId
  name: string
  highlight: boolean
  features: string[]
  prices: Record<Cycle, number> // dollars
  creditsPerMonth: number
}

const TIER_META: { tier: PlanTier; id: PlanId; name: string; highlight: boolean; features: string[] }[] = [
  { tier: 'FREE', id: 'free', name: 'Free', highlight: false, features: ['Fast & Balanced quality', 'Voice cloning', 'Standard queue'] },
  { tier: 'PRO', id: 'pro', name: 'Pro', highlight: true, features: ['All qualities incl. Studio', 'Voice cloning + lip sync', 'Priority queue', 'Background separation'] },
  { tier: 'STUDIO', id: 'studio', name: 'Studio', highlight: false, features: ['Everything in Pro', 'Batch dubbing', 'Highest fidelity output', 'Email support'] },
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
      id: m.id,
      name: m.name,
      highlight: m.highlight,
      features: m.features,
      prices: { weekly: priceFor('weekly'), monthly: priceFor('monthly'), yearly: priceFor('yearly') },
      creditsPerMonth: monthly?.creditsGranted ?? 0,
    }
  })
}

export default function Plans() {
  const { balance, planInfo } = useWallet()

  const [tiers, setTiers] = useState<UiTier[]>([])
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [history, setHistory] = useState<PaymentRow[]>([])
  const [cycle, setCycle] = useState<Cycle>('monthly')
  const [showCompare, setShowCompare] = useState(false)

  const [busyTier, setBusyTier] = useState<PlanTier | null>(null)
  const [toast, setToast] = useState<{ id: number; msg: string } | null>(null)

  useEffect(() => {
    getPlans()
      .then(({ plans }) => setTiers(buildTiers(plans)))
      .catch(() => {})
    void refreshAccount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshAccount() {
    const [sub, hist] = await Promise.all([
      getSubscription().catch(() => ({ subscription: null })),
      getHistory(1, 10).catch(() => ({ items: [] as PaymentRow[], page: 1, limit: 10, total: 0 })),
    ])
    setSubscription(sub.subscription)
    setHistory(hist.items)
  }

  const activeTier: PlanTier =
    subscription && subscription.status === 'ACTIVE' ? subscription.plan?.tier ?? 'FREE' : 'FREE'
  const activeCycle = subscription?.plan?.cycle

  // Redirect to the Stripe-hosted Payment Link. Payment Links own the whole
  // checkout UI — no client-side Stripe SDK needed.
  async function checkout(t: UiTier) {
    if (t.tier === 'FREE') return
    setBusyTier(t.tier)
    try {
      const api = CYCLES.find((c) => c.key === cycle)!.api
      const { url } = await getCheckoutUrl(t.tier, api)
      window.location.href = url
    } catch (e) {
      setBusyTier(null)
      setToast({ id: Date.now(), msg: e instanceof Error ? e.message : 'Could not start checkout' })
    }
  }

  async function onCancel() {
    try {
      const res = await cancelSubscription()
      setToast({ id: Date.now(), msg: res.message })
      await refreshAccount()
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
      {/* ── SECTION A · Subscriptions ──────────────────────────────────── */}
      <motion.section initial="hidden" animate="show" className="space-y-6">
        <motion.div variants={rise}>
          <CycleSwitch cycle={cycle} onChange={setCycle} />
        </motion.div>

        <motion.div variants={stagger} className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {tiers.length === 0
            ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="card shimmer h-96" />)
            : tiers.map((t) => (
                <TierCard
                  key={t.id}
                  tier={t}
                  cycle={cycle}
                  current={isCurrent(t)}
                  busy={busyTier === t.tier}
                  onSelect={() => checkout(t)}
                />
              ))}
        </motion.div>

        <motion.div variants={rise}>
          <CompareDisclosure open={showCompare} onToggle={() => setShowCompare((v) => !v)} />
        </motion.div>
      </motion.section>

      {/* ── SECTION B · Balance, subscription & history ─────────────────── */}
      <motion.section initial="hidden" animate="show" className="space-y-6">
        <motion.div variants={rise}>
          <BalanceCard balance={balance} allowance={planInfo.monthlyCredits} planName={planInfo.name} />
        </motion.div>

        <motion.div variants={rise}>
          <SubscriptionCard subscription={subscription} onCancel={onCancel} />
        </motion.div>

        {history.length > 0 && (
          <motion.div variants={rise}>
            <HistoryCard rows={history} />
          </motion.div>
        )}

        <p className="font-mono text-xs text-muted">
          Secure checkout is handled by Stripe. Credits are granted automatically once payment is confirmed.
        </p>
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
              className="focusable relative flex-1 rounded-[10px] px-3 py-2 text-center"
            >
              {cycle === c.key && (
                <motion.span
                  layoutId="cycle-pill"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  className="absolute inset-0 rounded-[10px] bg-brand/15 shadow-[inset_0_0_0_1px_rgb(var(--c-brand-500)/0.4)]"
                />
              )}
              <span className={`relative z-10 flex items-center justify-center gap-1.5 font-mono text-xs font-medium ${cycle === c.key ? 'text-brand' : 'text-muted hover:text-secondary'}`}>
                {c.label}
                {c.key === 'yearly' && (
                  <span className="rounded-pill bg-success/15 px-1.5 py-0.5 text-[9px] text-success">Save 20%</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </LayoutGroup>
      <p className="mt-1.5 text-center font-mono text-[10px] text-muted">
        {cycle === 'weekly' ? 'No commitment · cancel anytime' : cycle === 'yearly' ? 'Two months free vs. monthly' : 'Billed every month'}
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
  onSelect,
}: {
  tier: UiTier
  cycle: Cycle
  current: boolean
  busy: boolean
  onSelect: () => void
}) {
  const featured = tier.highlight
  const price = tier.prices[cycle]
  const suffix = CYCLES.find((c) => c.key === cycle)!.suffix
  const perMonthYear = cycle === 'yearly' && price > 0 ? (price / 12).toFixed(2) : null

  const cycleIndex = CYCLES.findIndex((c) => c.key === cycle)
  const [hover, setHover] = useState(false)
  const angle = useMotionValue(118)
  const gradient = useMotionTemplate`linear-gradient(${angle}deg, rgb(var(--c-brand-500)) 0%, rgb(var(--c-accent-magenta)) 52%, rgb(var(--c-accent-cyan)) 118%)`
  useEffect(() => {
    if (!featured) return
    const controls = animate(angle, 108 + cycleIndex * 26 + (hover ? 16 : 0), { duration: 0.5, ease: EASE_ENTRANCE })
    return () => controls.stop()
  }, [featured, cycleIndex, hover, angle])

  const nameColor = featured ? 'text-white/80' : 'text-muted'
  const priceColor = featured ? 'text-white' : 'text-primary'
  const subColor = featured ? 'text-white/85' : 'text-secondary'
  const isFree = tier.tier === 'FREE'

  const label = current
    ? 'Current plan'
    : busy
      ? 'Redirecting…'
      : isFree
        ? 'Free plan'
        : `Choose ${tier.name}`

  return (
    <motion.div
      variants={rise}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      whileHover={featured ? undefined : { y: -3 }}
      className={`relative flex flex-col overflow-hidden rounded-card p-6 ${
        featured ? 'text-white shadow-[var(--shadow-lg)] max-md:order-first' : 'card'
      } ${current ? 'ring-1 ring-brand' : ''}`}
    >
      {featured && <motion.span aria-hidden className="absolute inset-0 -z-10" style={{ backgroundImage: gradient }} />}

      <div className="flex items-center justify-between">
        <span className={`font-mono text-[11px] font-medium uppercase tracking-[0.12em] ${nameColor}`}>{tier.name}</span>
        {featured && (
          <span className="rounded-pill bg-white/25 px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-white backdrop-blur-sm">
            Popular
          </span>
        )}
      </div>

      <div className="mt-4 flex items-baseline gap-1">
        <span className={`font-mono text-4xl font-medium ${priceColor}`}>
          $<AnimatedNumber value={price} />
        </span>
        <span className={`font-mono text-sm ${featured ? 'text-white/70' : 'text-muted'}`}>{suffix}</span>
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
              className={`font-mono text-[11px] ${featured ? 'text-white/70' : 'text-muted'}`}
            >
              ${perMonthYear} / month billed yearly
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className={`mt-3 text-sm ${subColor}`}>{tier.creditsPerMonth.toLocaleString()} credits / month</div>

      <div className="mt-5 flex-1">
        <AnimatePresence mode="wait">
          <motion.ul
            key={cycle}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-2.5"
          >
            {tier.features.map((f) => (
              <li key={f} className={`flex items-start gap-2 text-sm ${featured ? 'text-white/90' : 'text-secondary'}`}>
                <svg viewBox="0 0 24 24" className={`mt-0.5 h-4 w-4 shrink-0 ${featured ? 'text-white' : 'text-brand'}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                {f}
              </li>
            ))}
          </motion.ul>
        </AnimatePresence>
      </div>

      <button
        onClick={onSelect}
        disabled={current || busy || isFree}
        className={`focusable mt-6 w-full rounded-pill py-3 font-mono text-sm font-semibold transition-colors disabled:cursor-default ${
          current
            ? featured
              ? 'bg-white/25 text-white'
              : 'border border-subtle bg-sunken text-muted'
            : featured
              ? 'bg-white text-[rgb(76_29_149)] hover:bg-white/90'
              : isFree
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

function CompareDisclosure({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="card overflow-hidden p-0">
      <button onClick={onToggle} className="focusable flex w-full items-center justify-between px-5 py-4 text-left">
        <span className="font-mono text-sm font-medium text-primary">Compare all features</span>
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
                    <th className="py-2 text-center font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">Free</th>
                    <th className="bg-brand/[0.04] py-2 text-center font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-brand">Pro</th>
                    <th className="py-2 text-center font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">Studio</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row) => (
                    <tr key={row.feature} className="border-b border-subtle last:border-0">
                      <td className="py-2.5 text-sm text-secondary">{row.feature}</td>
                      <CompareCell v={row.free} />
                      <CompareCell v={row.pro} tinted />
                      <CompareCell v={row.studio} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CompareCell({ v, tinted }: { v: boolean | string; tinted?: boolean }) {
  return (
    <td className={`py-2.5 text-center ${tinted ? 'bg-brand/[0.04]' : ''}`}>
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

      <BalanceRing pct={pct} balance={balance} allowance={allowance} />
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
  onCancel,
}: {
  subscription: Subscription | null
  onCancel: () => void
}) {
  if (!subscription || subscription.status === 'CANCELED' || subscription.status === 'EXPIRED') {
    return (
      <div className="card p-6">
        <SectionMark>Subscription</SectionMark>
        <p className="mt-2 text-sm text-secondary">
          You’re on the Free plan. Choose Pro or Studio above to add monthly credits.
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
          className="focusable rounded-pill border border-subtle bg-sunken px-4 py-2 font-mono text-xs text-secondary hover:text-primary"
        >
          Cancel subscription
        </button>
      )}
    </div>
  )
}

function StatusPill({ status, cancelAtPeriodEnd }: { status: string; cancelAtPeriodEnd: boolean }) {
  const [label, cls] = cancelAtPeriodEnd
    ? ['Canceling', 'bg-warning/15 text-warning']
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
                ${(r.amountCents / 100).toFixed(2)}
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

function SectionMark({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">/ {children}</span>
}
