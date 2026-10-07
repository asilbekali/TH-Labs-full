import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreditReason, SubscriptionStatus } from '@prisma/client';

import { PaymentService } from './payment.service';
import { PrismaService } from '../prisma/prisma.service';

// The jobs that stand in for a webhook, plus the subscription lifecycle.
//
// `sweepStoreOrders` finds every paid order in the store that is not credited
// yet — the buyer who paid and closed the tab, the one who reached the LS link
// some other way — every minute, so credits arrive whether or not they come
// back (and within seconds when the LS webhook is configured).
//
// `syncRenewals` is the same idea for the charges after the first: LS bills a
// subscription again at the end of each period, and those renewals are only
// visible by asking.
//
// `grantDueSubscriptions` is what makes YEARLY plans drip: the purchase is
// charged once, but credits are handed out every `plan.grantDays`,
// `plan.grantsPerPeriod` times. Without it a user could buy a year, burn
// 14 400 credits in a week and stop paying.
//
// `expireLapsedSubscriptions` is the other half: when a period ends and no
// renewal arrives, the row has to stop counting as active or the user keeps
// their paid tier forever.
@Injectable()
export class PaymentCron {
  private readonly logger = new Logger(PaymentCron.name);
  private claiming = false;
  private syncing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: PaymentService,
  ) {}

  // Every minute: credit any paid order in the store from the last three days
  // that is not credited yet, matched to its account by email. One LS request
  // per run. This replaced watching only the accounts that had opened a
  // checkout through this API, which missed every buyer who did not — and
  // every order LS confirmed after the success page stopped asking.
  private static readonly SWEEP_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
  private sweeping = false;

  @Cron(CronExpression.EVERY_MINUTE)
  async sweepStoreOrders(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const r = await this.service.sweepStoreOrders(PaymentCron.SWEEP_WINDOW_MS);
      if (r.credited > 0 || r.noAccount > 0) {
        this.logger.log(
          `Order sweep: ${r.checked} uncredited paid order(s), ` +
            `${r.credited} account(s) credited, ${r.noAccount} with no account`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Order sweep failed, will retry next minute: ${
          err instanceof Error ? err.message : err
        }`,
      );
    } finally {
      this.sweeping = false;
    }
  }

  /** Claims for accounts that opened a checkout within `windowMs`. Not scheduled — the sweep covers it. */
  async claimPendingCheckouts(windowMs: number): Promise<number> {
    // A slow LS response must not stack a second run on top of the first.
    if (this.claiming) return 0;
    this.claiming = true;
    try {
      const since = new Date(Date.now() - windowMs);
      const users = await this.prisma.user.findMany({
        where: { lsCheckoutStartedAt: { gte: since } },
        select: { id: true },
      });

      let credited = 0;
      for (const { id } of users) {
        try {
          const result = await this.service.claimOrders(id);
          if (result.claimed) {
            credited++;
            this.logger.log(
              `Cron credited user ${id} with ${result.creditsGranted} credits ` +
                `(${result.granted.map((g) => g.description).join('; ')})`,
            );
          }
        } catch (err) {
          this.logger.warn(
            `Pending-checkout claim for user ${id} failed, will retry: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
      return credited;
    } finally {
      this.claiming = false;
    }
  }

  // Renewals land at `renews_at`, which is what the stored period ends on — so
  // only subscriptions at or past the end of their period need asking about,
  // and the grace window in PaymentService.isLapsed keeps them on their tier
  // meanwhile. Runs before the expiry sweep so a renewal charged in the last
  // hour reactivates the row instead of racing it.
  @Cron(CronExpression.EVERY_HOUR)
  async syncRenewalsThenExpire(): Promise<void> {
    await this.syncRenewals();
    await this.expireLapsedSubscriptions();
  }

  async syncRenewals(): Promise<number> {
    if (this.syncing) return 0;
    this.syncing = true;
    try {
      const now = Date.now();
      const subs = await this.prisma.subscription.findMany({
        where: {
          lsSubscriptionId: { not: null },
          status: {
            in: [
              SubscriptionStatus.ACTIVE,
              SubscriptionStatus.PAST_DUE,
              SubscriptionStatus.EXPIRED,
            ],
          },
          currentPeriodEnd: {
            lte: new Date(now + 60 * 60 * 1000),
            // A card LS gave up on long ago is not coming back.
            gte: new Date(now - 40 * 24 * 60 * 60 * 1000),
          },
        },
        include: { plan: true },
      });

      let renewed = 0;
      for (const sub of subs) {
        try {
          renewed += (await this.service.syncRenewals(sub)).length;
        } catch (err) {
          this.logger.warn(
            `Renewal sync for subscription ${sub.id} failed, will retry: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
      if (renewed > 0) this.logger.log(`Credited ${renewed} renewal(s)`);
      return renewed;
    } finally {
      this.syncing = false;
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async grantDueSubscriptions(): Promise<number> {
    const now = new Date();

    // Candidate subscriptions: active, still inside their paid period, and
    // due (never granted, or last grant older than grantDays). The grantDays
    // comparison can't be expressed in a single Prisma filter, so we pull
    // active-in-period rows and test each against its plan.
    const candidates = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: { gt: now },
      },
      include: { plan: true },
    });

    let granted = 0;
    for (const sub of candidates) {
      // The period is only worth grantsPerPeriod allocations (1 for monthly,
      // 12 for yearly). Checkout and renewal each count as the first,
      // so this is the ceiling that stops a 365-day period paying out a
      // thirteenth month.
      if (sub.grantsIssued >= sub.plan.grantsPerPeriod) continue;

      const dueAt = sub.lastGrantAt
        ? new Date(
            sub.lastGrantAt.getTime() +
              sub.plan.grantDays * 24 * 60 * 60 * 1000,
          )
        : new Date(0);
      if (dueAt > now) continue;

      // Grant and stamp lastGrantAt in the SAME transaction, with a guard on
      // the stamp we read — so two overlapping cron runs can't double-grant.
      try {
        await this.service.runInTransaction(async (tx) => {
          const stamp = await tx.subscription.updateMany({
            where: {
              id: sub.id,
              // Re-check the due condition atomically.
              lastGrantAt: sub.lastGrantAt,
              grantsIssued: sub.grantsIssued,
            },
            data: { lastGrantAt: now, grantsIssued: { increment: 1 } },
          });
          if (stamp.count === 0) return; // another run beat us to it

          await this.service.grantCredits(
            sub.userId,
            sub.plan.creditsGranted,
            CreditReason.SUBSCRIPTION_GRANT,
            sub.id,
            `${sub.plan.tier} ${sub.plan.cycle} recurring grant ` +
              `(${sub.grantsIssued + 1}/${sub.plan.grantsPerPeriod})`,
            tx,
          );
          granted++;
        });
      } catch (err) {
        this.logger.error(
          `Recurring grant failed for subscription ${sub.id}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    if (granted > 0) {
      this.logger.log(
        `Recurring cron granted credits to ${granted} subscription(s)`,
      );
    }
    return granted;
  }

  // Sweep subscriptions whose paid period has run out without a renewal.
  //
  // Flipping it to EXPIRED is what puts the user back on Free — nothing else
  // reads a "current tier", it is derived from the live subscription row. A
  // renewal that arrives later sets it ACTIVE again (syncRenewals).
  //
  // Unspent credits are deliberately left alone: they were paid for, and the
  // cancel endpoint makes the same promise.
  async expireLapsedSubscriptions(): Promise<number> {
    const now = new Date();

    const candidates = await this.prisma.subscription.findMany({
      where: {
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
        },
        currentPeriodEnd: { lte: now },
      },
      select: {
        id: true,
        currentPeriodEnd: true,
        lsSubscriptionId: true,
        cancelAtPeriodEnd: true,
      },
    });
    // Same rule as reads use, including the renewal grace for LS-billed plans.
    const lapsed = candidates.filter((s) => this.service.isLapsed(s, now));
    if (lapsed.length === 0) return 0;

    const { count } = await this.prisma.subscription.updateMany({
      where: {
        id: { in: lapsed.map((s) => s.id) },
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
        },
      },
      data: { status: SubscriptionStatus.EXPIRED },
    });

    if (count > 0) {
      this.logger.log(
        `Expired ${count} lapsed subscription(s) → users back on Free (credits kept)`,
      );
    }
    return count;
  }
}
