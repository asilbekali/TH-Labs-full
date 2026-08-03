import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreditReason, SubscriptionStatus } from '@prisma/client';

import { PaymentService } from './payment.service';
import { PrismaService } from '../prisma/prisma.service';

// The recurring-grant cron is what makes YEARLY plans drip monthly: Stripe
// bills once, but credits are handed out every `plan.grantDays`. Without it a
// user could buy a year, burn 24 000 credits in a week, and cancel.
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
            },
            data: { lastGrantAt: now },
          });
          if (stamp.count === 0) return; // another run beat us to it

          await this.service.grantCredits(
            sub.userId,
            sub.plan.creditsGranted,
            CreditReason.SUBSCRIPTION_GRANT,
            sub.id,
            `${sub.plan.tier} ${sub.plan.cycle} recurring grant`,
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
}
