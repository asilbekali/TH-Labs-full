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
  Prisma,
  PrismaClient,
  SubscriptionStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';
import { CanDubDto, CanDubResult } from './dto/can-dub.dto';
import { CommitDubDto, CommitDubResult } from './dto/commit-dub.dto';
import { QUALITY_COST, costForQuality } from './quality-cost';

// A Prisma transaction client — the subset of the client available inside
// `$transaction(async (tx) => …)`.
type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// Length of one billing period, in days, per cycle. Used to compute a
// subscription's period end when Stripe doesn't hand us one.
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
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
  ) {}

  private get freeDubMaxSeconds(): number {
    return Number(this.config.get('FREE_DUB_MAX_SECONDS')) || 120;
  }

  // ── Catalog ────────────────────────────────────────────────────────────
  async getPlans() {
    const plans = await this.prisma.plan.findMany({
      where: { active: true },
      orderBy: [{ priceCents: 'asc' }],
    });
    return {
      plans,
      qualityCost: QUALITY_COST,
      freeDubMaxSeconds: this.freeDubMaxSeconds,
    };
  }

  // ── Checkout ───────────────────────────────────────────────────────────
  // Payment Links are Stripe-hosted, so we never see card data. The only way
  // the webhook can later tell who paid is the `client_reference_id` we append
  // here — it maps straight back to our User.id.
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
    if (!plan.stripeLinkUrl) {
      throw new BadRequestException(
        `No Stripe Payment Link configured for ${tier} ${cycle}.`,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const url =
      `${plan.stripeLinkUrl}?client_reference_id=${userId}` +
      `&prefilled_email=${encodeURIComponent(user.email)}`;

    return {
      url,
      tier: plan.tier,
      cycle: plan.cycle,
      priceCents: plan.priceCents,
      creditsGranted: plan.creditsGranted,
    };
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

    // 2. Active subscription or enough credits → paid dub.
    const hasActiveSub = await this.hasActiveSubscription(userId);
    if (hasActiveSub || user.credits >= cost) {
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
    return { subscription };
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

    if (subscription.stripeSubscriptionId && this.stripe.enabled) {
      await this.stripe.cancelAtPeriodEnd(subscription.stripeSubscriptionId);
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
  // Tier/cycle/amount are ALWAYS derived from the Stripe object, never trusted
  // from the client. We resolve by price id when the Plan carries one, and fall
  // back to the (distinct) price amounts otherwise — Payment Links don't force
  // us to pre-seed price ids.
  async resolvePlanFromStripePrice(priceId: string | null | undefined) {
    if (!priceId) return null;
    return this.prisma.plan.findUnique({ where: { stripePriceId: priceId } });
  }

  async resolvePlan(opts: {
    priceId?: string | null;
    amountCents?: number | null;
  }): Promise<Plan | null> {
    const byPrice = await this.resolvePlanFromStripePrice(opts.priceId);
    if (byPrice) return byPrice;

    if (opts.amountCents != null) {
      const matches = await this.prisma.plan.findMany({
        where: { priceCents: opts.amountCents, active: true, tier: { not: PlanTier.FREE } },
      });
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) {
        this.logger.warn(
          `Ambiguous plan resolution: ${matches.length} plans priced at ${opts.amountCents}c`,
        );
      }
    }
    return null;
  }

  cyclePeriodEnd(cycle: BillingCycle, from: Date = new Date()): Date {
    const end = new Date(from);
    end.setDate(end.getDate() + CYCLE_DAYS[cycle]);
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
