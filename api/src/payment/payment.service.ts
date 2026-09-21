import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BillingCycle,
  CreditReason,
  Plan,
  PlanTier,
  PrismaClient,
  SubscriptionStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { DodoService } from './dodo.service';
import { CREDITS_PER_MINUTE, QUALITY_MULTIPLIER } from './credit-packs';
import { CanDubDto, CanDubResult } from './dto/can-dub.dto';
import { CommitDubDto, CommitDubResult } from './dto/commit-dub.dto';
import { QUALITY_COST, costForQuality } from './quality-cost';

// Metadata we stamp on every checkout and read back off the webhook. Prefixed
// so it can never collide with a key the dashboard or a discount campaign
// adds, and kept here because the webhook handler must spell them identically.
export const META_USER_ID = 'th_user_id';
export const META_PLAN_ID = 'th_plan_id';
export const META_PACK_ID = 'th_pack_id';

// A Prisma transaction client — the subset of the client available inside
// `$transaction(async (tx) => …)`.
type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// Length of one billing period, in days, per cycle. Only WEEKLY is expressed
// in days — monthly and yearly are calendar arithmetic (see cyclePeriodEnd).
const CYCLE_DAYS: Record<BillingCycle, number> = {
  WEEKLY: 7,
  MONTHLY: 30,
  YEARLY: 365,
};

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dodo: DodoService,
    private readonly config: ConfigService,
  ) {}

  private get freeDubMaxSeconds(): number {
    return Number(this.config.get('FREE_DUB_MAX_SECONDS')) || 120;
  }

  private get appUrl(): string {
    return (
      this.config.get<string>('APP_URL')?.trim() || 'http://localhost:5173'
    );
  }

  // Where Dodo sends the customer once checkout finishes. It arrives with
  // `?payment_id=…&status=…` appended; the page only observes, the webhook is
  // what grants credits.
  private get returnUrl(): string {
    return `${this.appUrl.replace(/\/$/, '')}/plans/success`;
  }

  // ── Catalog ────────────────────────────────────────────────────────────
  async getPlans() {
    const plans = await this.prisma.plan.findMany({
      where: { active: true },
      orderBy: [{ priceCents: 'asc' }],
    });

    // Whether money can move at all, reported by the server rather than
    // inferred in the browser from a build-time key. A paid plan is buyable
    // only once its Dodo product is configured, and the UI needs to say which
    // ones are not rather than offering a button that 400s on click.
    const paid = plans.filter((p) => p.tier !== PlanTier.FREE);
    const unconfigured = paid.filter((p) => !p.dodoProductId && !p.dodoLinkUrl);

    return {
      plans,
      qualityCost: QUALITY_COST,
      freeDubMaxSeconds: this.freeDubMaxSeconds,
      checkout: {
        provider: 'dodo' as const,
        mode: this.dodo.environment === 'live_mode' ? ('live' as const) : ('test' as const),
        /** True when at least one paid plan can actually be checked out. */
        configured: paid.length > unconfigured.length,
        /** `TIER/CYCLE` for every paid plan still missing a product. */
        missingProducts: unconfigured.map((p) => `${p.tier}/${p.cycle}`),
        /** Hosted checkout sessions; false means static links only. */
        apiConfigured: this.dodo.enabled,
        /** False when DODO_WEBHOOK_SECRET is unset — no grant can ever land. */
        webhookConfigured: this.dodo.webhookConfigured,
      },
    };
  }

  // ── One-time credit packs ──────────────────────────────────────────────
  // The catalog is the CreditPack table, managed from the admin panel. A pack
  // with no Dodo product is still listed — the price is real information —
  // but is marked unavailable so the page can disable its button instead of
  // failing at checkout.
  async getCreditPacks() {
    const packs = await this.prisma.creditPack.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { credits: 'asc' }],
    });

    return {
      packs: packs.map((pack) => ({
        id: pack.slug,
        credits: pack.credits,
        priceCents: pack.priceCents,
        currency: pack.currency,
        ...(pack.popular ? { popular: true } : {}),
        available: !!(pack.dodoProductId || pack.dodoLinkUrl),
      })),
      creditsPerMinute: CREDITS_PER_MINUTE,
      qualityMultiplier: QUALITY_MULTIPLIER,
    };
  }

  // ── Checkout ───────────────────────────────────────────────────────────
  // Dodo owns the whole payment form, so card data never reaches this origin.
  // What we own is the identity: the metadata stamped here is the only thing
  // that tells the webhook which of our users paid, and which plan they paid
  // for.
  //
  // With an API key we create a hosted checkout session, where that metadata
  // travels server-side and cannot be edited. Without one we fall back to a
  // static payment link carrying the same keys as query parameters — which the
  // customer can see and change, so the webhook re-checks the user id against
  // the paying email before it grants anything.
  async getCheckoutUrl(userId: number, tier: PlanTier, cycle: BillingCycle) {
    if (tier === PlanTier.FREE) {
      throw new BadRequestException('The FREE tier cannot be checked out.');
    }

    const plan = await this.prisma.plan.findUnique({
      where: { tier_cycle: { tier, cycle } },
    });
    if (!plan || !plan.active) {
      throw new BadRequestException('Unknown or inactive plan.');
    }
    if (!plan.dodoProductId && !plan.dodoLinkUrl) {
      throw new BadRequestException(
        `No Dodo Payments product configured for ${tier} ${cycle}. ` +
          'Add its product link in the admin panel, or set ' +
          `DODO_PRODUCT_${tier}_${cycle} and re-run the seed.`,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const url = await this.checkoutUrlFor({
      productId: plan.dodoProductId,
      linkUrl: plan.dodoLinkUrl,
      user,
      metadata: {
        [META_USER_ID]: String(userId),
        [META_PLAN_ID]: plan.id,
      },
    });

    return {
      url,
      tier: plan.tier,
      cycle: plan.cycle,
      priceCents: plan.priceCents,
      creditsGranted: plan.creditsGranted,
    };
  }

  /** Checkout for a one-time credit pack — no subscription is created. */
  async getCreditCheckoutUrl(userId: number, packSlug: string) {
    const pack = await this.prisma.creditPack.findUnique({
      where: { slug: packSlug },
    });
    if (!pack || !pack.active) {
      throw new BadRequestException(`Unknown or inactive credit pack '${packSlug}'.`);
    }
    if (!pack.dodoProductId && !pack.dodoLinkUrl) {
      throw new BadRequestException(
        `No Dodo Payments product configured for ${pack.slug}. ` +
          'Add its product link in the admin panel.',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const url = await this.checkoutUrlFor({
      productId: pack.dodoProductId,
      linkUrl: pack.dodoLinkUrl,
      user,
      metadata: {
        [META_USER_ID]: String(userId),
        [META_PACK_ID]: pack.slug,
      },
    });

    return {
      url,
      packId: pack.slug,
      credits: pack.credits,
      priceCents: pack.priceCents,
    };
  }

  private async checkoutUrlFor(opts: {
    productId: string | null;
    linkUrl: string | null;
    user: { email: string; name: string };
    metadata: Record<string, string>;
  }): Promise<string> {
    const customer = { email: opts.user.email, name: opts.user.name };

    if (this.dodo.enabled && opts.productId) {
      try {
        return await this.dodo.createCheckoutSession({
          productId: opts.productId,
          customer,
          metadata: opts.metadata,
          returnUrl: this.returnUrl,
        });
      } catch (err) {
        // A misconfigured product id, a revoked key, Dodo being down: the
        // static link still works for all three, so fall back rather than
        // failing the purchase — but say so, because the metadata is weaker.
        this.logger.warn(
          `Checkout session failed (${err instanceof Error ? err.message : err}); ` +
            'falling back to the static payment link',
        );
      }
    }

    const link = opts.linkUrl ?? opts.productId;
    if (!link) {
      throw new BadRequestException('No Dodo Payments product configured.');
    }
    return this.dodo.staticCheckoutUrl(link, {
      customer,
      metadata: opts.metadata,
      returnUrl: this.returnUrl,
    });
  }

  // ── Credit ledger primitives ─────────────────────────────────────────────
  // The ledger (CreditEntry) is the source of truth; User.credits is a cached
  // balance. Both are written inside one transaction, always.
  private async applyCredits(
    tx: Tx,
    userId: number,
    delta: number,
    reason: CreditReason,
    refId?: string | null,
    note?: string | null,
  ): Promise<number> {
    const user = await tx.user.update({
      where: { id: userId },
      data: { credits: { increment: delta } },
      select: { credits: true },
    });
    await tx.creditEntry.create({
      data: {
        userId,
        delta,
        balance: user.credits,
        reason,
        refId: refId ?? null,
        note: note ?? null,
      },
    });
    return user.credits;
  }

  async grantCredits(
    userId: number,
    amount: number,
    reason: CreditReason,
    refId?: string | null,
    note?: string | null,
    tx?: Tx,
  ): Promise<number> {
    if (amount <= 0) {
      throw new BadRequestException('Grant amount must be positive.');
    }
    if (tx) return this.applyCredits(tx, userId, amount, reason, refId, note);
    return this.prisma.$transaction((t) =>
      this.applyCredits(t, userId, amount, reason, refId, note),
    );
  }

  // Atomic, race-safe spend. The conditional decrement (updateMany with a
  // `credits >= amount` guard) means two concurrent spends can never both pass
  // the balance check — exactly one wins and the balance never goes negative.
  async spendCredits(
    userId: number,
    amount: number,
    jobId: string,
    note?: string,
  ): Promise<number> {
    if (amount <= 0) throw new BadRequestException('Spend amount must be positive.');
    return this.prisma.$transaction(async (tx) => {
      const decremented = await tx.user.updateMany({
        where: { id: userId, credits: { gte: amount } },
        data: { credits: { decrement: amount } },
      });
      if (decremented.count === 0) {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { credits: true },
        });
        if (!user) throw new NotFoundException('User not found.');
        throw new BadRequestException('INSUFFICIENT_CREDITS');
      }
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { credits: true },
      });
      await tx.creditEntry.create({
        data: {
          userId,
          delta: -amount,
          balance: user!.credits,
          reason: CreditReason.DUB_SPEND,
          refId: jobId,
          note: note ?? `dub ${jobId}`,
        },
      });
      return user!.credits;
    });
  }

  // ── The free-dub / credit gate ──────────────────────────────────────────
  async canDub(userId: number, dto: CanDubDto): Promise<CanDubResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const cost = costForQuality(dto.quality);
    const max = this.freeDubMaxSeconds;

    // 1. The one free dub, if unused and within the length cap.
    if (!user.freeDubUsed && dto.durationSeconds <= max) {
      return {
        allowed: true,
        isFreeDub: true,
        cost: 0,
        balance: user.credits,
        reason: null,
      };
    }

    // 2. Enough credits → paid dub. A subscription alone is not enough: a
    //    subscriber who has spent the month's allocation has to wait for the
    //    next grant like everyone else. This has to agree with commitDub,
    //    which enforces the balance unconditionally — letting a subscription
    //    pass here just moved the failure from a clean preflight refusal to a
    //    mid-job INSUFFICIENT_CREDITS.
    if (user.credits >= cost) {
      return {
        allowed: true,
        isFreeDub: false,
        cost,
        balance: user.credits,
        reason: null,
      };
    }

    // 3. Denied. If the free dub is still unused, the blocker is length;
    //    otherwise it's an empty wallet.
    return {
      allowed: false,
      isFreeDub: false,
      cost,
      balance: user.credits,
      reason:
        !user.freeDubUsed && dto.durationSeconds > max
          ? 'FREE_DUB_LENGTH_EXCEEDED'
          : 'INSUFFICIENT_CREDITS',
    };
  }

  // Charge the dub. This is where credits actually move (or the free dub is
  // consumed). Idempotent on jobId: a retried request returns the first result
  // and never charges twice.
  async commitDub(userId: number, dto: CommitDubDto): Promise<CommitDubResult> {
    const cost = costForQuality(dto.quality);
    const max = this.freeDubMaxSeconds;

    return this.prisma.$transaction(async (tx) => {
      // Idempotency: a ledger row already tagged with this jobId means we've
      // committed it before. (Free dubs write a delta:0 marker row.)
      const existing = await tx.creditEntry.findFirst({
        where: { userId, refId: dto.jobId, reason: CreditReason.DUB_SPEND },
      });
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found.');

      if (existing) {
        return {
          jobId: dto.jobId,
          charged: existing.delta < 0,
          isFreeDub: existing.delta === 0,
          cost: Math.abs(existing.delta),
          balance: user.credits,
          idempotent: true,
        };
      }

      // Free dub path — consume it, charge nothing, but leave a marker row.
      if (!user.freeDubUsed && dto.durationSeconds <= max) {
        await tx.user.update({
          where: { id: userId },
          data: { freeDubUsed: true },
        });
        await tx.creditEntry.create({
          data: {
            userId,
            delta: 0,
            balance: user.credits,
            reason: CreditReason.DUB_SPEND,
            refId: dto.jobId,
            note: 'free dub',
          },
        });
        return {
          jobId: dto.jobId,
          charged: false,
          isFreeDub: true,
          cost: 0,
          balance: user.credits,
          idempotent: false,
        };
      }

      // Paid path — atomic guarded decrement.
      const decremented = await tx.user.updateMany({
        where: { id: userId, credits: { gte: cost } },
        data: { credits: { decrement: cost } },
      });
      if (decremented.count === 0) {
        throw new BadRequestException('INSUFFICIENT_CREDITS');
      }
      const after = await tx.user.findUnique({
        where: { id: userId },
        select: { credits: true },
      });
      await tx.creditEntry.create({
        data: {
          userId,
          delta: -cost,
          balance: after!.credits,
          reason: CreditReason.DUB_SPEND,
          refId: dto.jobId,
          note: `dub ${dto.jobId} (${dto.quality})`,
        },
      });
      return {
        jobId: dto.jobId,
        charged: true,
        isFreeDub: false,
        cost,
        balance: after!.credits,
        idempotent: false,
      };
    });
  }

  // ── Subscriptions ────────────────────────────────────────────────────────
  async hasActiveSubscription(userId: number): Promise<boolean> {
    const sub = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: { gt: new Date() },
      },
    });
    return sub !== null;
  }

  async getSubscription(userId: number) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
    if (!subscription) return { subscription: null };

    // The expiry cron only runs hourly, so a row can still be stamped ACTIVE
    // for a period that ended minutes ago. Callers use this to decide which
    // tier to show, so report the effective status rather than the stored one
    // — the cron catches up and writes the same value shortly after.
    const lapsed =
      subscription.currentPeriodEnd <= new Date() &&
      (subscription.status === SubscriptionStatus.ACTIVE ||
        subscription.status === SubscriptionStatus.PAST_DUE);

    return {
      subscription: lapsed
        ? { ...subscription, status: SubscriptionStatus.EXPIRED }
        : subscription,
    };
  }

  async cancelSubscription(userId: number) {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) {
      throw new NotFoundException('No active subscription to cancel.');
    }

    // Tell Dodo first. Flipping our own row while the provider keeps billing
    // would be worse than refusing: the user would see "cancelled" and still
    // be charged, with nothing in our logs to explain it.
    if (subscription.dodoSubscriptionId && this.dodo.enabled) {
      await this.dodo.cancelAtPeriodEnd(subscription.dodoSubscriptionId);
    }

    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: true },
    });
    return {
      subscription: updated,
      message:
        'Subscription will not renew. Access and unspent credits remain until the period ends.',
    };
  }

  // A link into Dodo's own portal, where the customer can see invoices,
  // swap the card behind a subscription and cancel without us proxying any of
  // it. The id is stamped on the user by the first payment webhook, so this
  // only exists once they have actually paid for something.
  async getCustomerPortalUrl(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { dodoCustomerId: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    if (!user.dodoCustomerId) {
      throw new BadRequestException(
        'No billing account yet — the portal opens after your first payment.',
      );
    }
    return { url: await this.dodo.customerPortalLink(user.dodoCustomerId) };
  }

  // ── History & ledger ─────────────────────────────────────────────────────
  async getHistory(userId: number, page: number, limit: number) {
    const [total, items] = await this.prisma.$transaction([
      this.prisma.payment.count({ where: { userId } }),
      this.prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { page, limit, total, items };
  }

  async getCredits(userId: number, page: number, limit: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });
    if (!user) throw new NotFoundException('User not found.');

    const [total, entries] = await this.prisma.$transaction([
      this.prisma.creditEntry.count({ where: { userId } }),
      this.prisma.creditEntry.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { balance: user.credits, page, limit, total, entries };
  }

  // Dev-only drift report: the ledger's net delta must equal the cached balance,
  // and each row's running `balance` must be internally consistent.
  async reconcile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });
    if (!user) throw new NotFoundException('User not found.');

    const entries = await this.prisma.creditEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    let running = 0;
    let brokenAt: string | null = null;
    for (const e of entries) {
      running += e.delta;
      if (running !== e.balance && brokenAt === null) brokenAt = e.id;
    }

    const ledgerBalance = running;
    return {
      cachedBalance: user.credits,
      ledgerBalance,
      inSync: user.credits === ledgerBalance && brokenAt === null,
      firstBrokenEntryId: brokenAt,
      entryCount: entries.length,
    };
  }

  // ── Plan resolution (webhook helpers) ────────────────────────────────────
  // Tier, cycle and amount are ALWAYS derived from the Dodo object, never
  // trusted from the client.
  //
  // The product id is the reliable route: it is on every subscription payload
  // and is exactly what we seeded onto the Plan row. The plan id carried in
  // our own checkout metadata is just as good and survives a product being
  // re-created in the dashboard, so it is tried first. Amount matching is the
  // last resort, for a payment that reached us with neither.
  async resolvePlanByProduct(productId: string | null | undefined) {
    if (!productId) return null;
    return this.prisma.plan.findUnique({ where: { dodoProductId: productId } });
  }

  async resolvePlan(opts: {
    planId?: string | null;
    productId?: string | null;
    amountCents?: number | null;
  }): Promise<Plan | null> {
    if (opts.planId) {
      const byId = await this.prisma.plan.findUnique({
        where: { id: opts.planId },
      });
      if (byId) return byId;
      this.logger.warn(
        `Checkout metadata named plan ${opts.planId}, which no longer exists; ` +
          'falling back to the product id',
      );
    }

    const byProduct = await this.resolvePlanByProduct(opts.productId);
    if (byProduct) return byProduct;

    if (opts.amountCents != null) {
      const paid = await this.prisma.plan.findMany({
        where: { active: true, tier: { not: PlanTier.FREE } },
      });
      const matches = paid.filter((p) => p.priceCents === opts.amountCents);
      if (matches.length === 1) return matches[0];

      if (matches.length > 1) {
        this.logger.warn(
          `Ambiguous plan resolution: ${matches.length} plans priced at ${opts.amountCents}c ` +
            `(${matches.map((p) => `${p.tier}/${p.cycle}`).join(', ')}). ` +
            'Give these plans distinct prices, or seed dodoProductId.',
        );
      } else {
        // The usual cause is a product id that was never seeded onto the Plan
        // row. Print the catalog so the mismatch is obvious from the one log
        // line, instead of "no credits appeared".
        this.logger.error(
          `Could not resolve a plan for product ${opts.productId ?? 'unknown'} ` +
            `at ${opts.amountCents}c. Seeded products: ` +
            paid
              .map((p) => `${p.tier}/${p.cycle}=${p.dodoProductId ?? 'unset'}@${p.priceCents}c`)
              .join(', ') +
            '. Set the DODO_PRODUCT_* env vars and re-run the seed.',
        );
      }
    }
    return null;
  }

  // When a monthly plan is bought on Aug 25 it must lapse on Sep 25, not on
  // Sep 24 — so monthly and yearly step by calendar units, not by a fixed
  // 30/365 days. Only the day-of-month is clamped: buying on Jan 31 gives a
  // period ending Feb 28 (or 29), which is what Dodo does too.
  cyclePeriodEnd(cycle: BillingCycle, from: Date = new Date()): Date {
    const end = new Date(from);
    if (cycle === 'WEEKLY') {
      end.setDate(end.getDate() + CYCLE_DAYS.WEEKLY);
      return end;
    }

    const months = cycle === 'YEARLY' ? 12 : 1;
    const day = end.getDate();
    // setMonth on the 31st would roll into the next month (Jan 31 → Mar 3).
    // Pin to the 1st first, move the month, then clamp the day back on.
    end.setDate(1);
    end.setMonth(end.getMonth() + months);
    const daysInTargetMonth = new Date(
      end.getFullYear(),
      end.getMonth() + 1,
      0,
    ).getDate();
    end.setDate(Math.min(day, daysInTargetMonth));
    return end;
  }

  // Expose primitives the webhook handler and cron compose with.
  get db(): PrismaService {
    return this.prisma;
  }

  runInTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}

export type { Tx };
