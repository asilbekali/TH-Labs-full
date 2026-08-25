import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreditReason, SubscriptionStatus } from '@prisma/client';

import { PaymentService } from './payment.service';
import { PrismaService } from '../prisma/prisma.service';

// Two jobs run the subscription lifecycle between webhooks.
//
// `grantDueSubscriptions` is what makes YEARLY plans drip: Stripe bills once,
// but credits are handed out every `plan.grantDays`, `plan.grantsPerPeriod`
// times. Without it a user could buy a year, burn 14 400 credits in a week and
// cancel.
//
// `expireLapsedSubscriptions` is the other half: when a period ends and no
// renewal arrives, the row has to stop counting as active or the user keeps
// their paid tier forever. Buy on Aug 25, no renewal, and this drops them back
// to Free on Sep 25.
@Injectable()
export class PaymentCron {
  private readonly logger = new Logger(PaymentCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: PaymentService,
  ) {}

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
      // The period is only worth grantsPerPeriod allocations (1 for weekly and
      // monthly, 12 for yearly). Checkout and renewal each count as the first,
      // so this is the ceiling that stops a 365-day period paying out a
      // thirteenth month.
      if (sub.grantsIssued >= sub.plan.grantsPerPeriod) continue;

      const dueAt = sub.lastGrantAt
        ? new Date(
            sub.lastGrantAt.getTime() + sub.plan.grantDays * 24 * 60 * 60 * 1000,
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
      this.logger.log(`Recurring cron granted credits to ${granted} subscription(s)`);
    }
    return granted;
  }

  // Sweep subscriptions whose paid period has run out without a renewal.
  //
  // A successful renewal pushes currentPeriodEnd forward (invoice.paid) long
  // before this runs, so anything still sitting in the past has genuinely
  // lapsed: cancelled, one-off, or a card that never recovered from PAST_DUE.
  // Flipping it to EXPIRED is what puts the user back on Free — nothing else
  // reads a "current tier", it is derived from the live subscription row.
  //
  // Unspent credits are deliberately left alone: they were paid for, and the
  // cancel endpoint makes the same promise.
  @Cron(CronExpression.EVERY_HOUR)
  async expireLapsedSubscriptions(): Promise<number> {
    const now = new Date();

    const { count } = await this.prisma.subscription.updateMany({
      where: {
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
        },
        currentPeriodEnd: { lte: now },
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
