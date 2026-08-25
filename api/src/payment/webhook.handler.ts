import { Injectable, Logger } from '@nestjs/common';
import { CreditReason, SubscriptionStatus } from '@prisma/client';
import Stripe from 'stripe';

import { PaymentService } from './payment.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';

// Pull an id string out of a field Stripe sends as `string | {id} | null`.
function idOf(
  ref: string | { id: string } | null | undefined,
): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id;
}

// Map Stripe's subscription status vocabulary onto ours.
function mapStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case 'active':
    case 'trialing':
      return SubscriptionStatus.ACTIVE;
    case 'past_due':
    case 'unpaid':
      return SubscriptionStatus.PAST_DUE;
    case 'canceled':
      return SubscriptionStatus.CANCELED;
    case 'incomplete_expired':
      return SubscriptionStatus.EXPIRED;
    default:
      return SubscriptionStatus.ACTIVE;
  }
}

function periodEndFromSub(sub: Stripe.Subscription): Date | null {
  const raw =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    sub.items?.data?.[0]?.current_period_end;
  return raw ? new Date(raw * 1000) : null;
}

// Dispatches verified Stripe events. Idempotency is enforced upstream in
// PaymentController before this runs, via the WebhookEvent unique constraint.
@Injectable()
export class StripeWebhookHandler {
  private readonly logger = new Logger(StripeWebhookHandler.name);

  constructor(
    private readonly service: PaymentService,
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  async dispatch(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutCompleted(event.data.object);
        break;
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        await this.onInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await this.onInvoiceFailed(event.data.object as Stripe.Invoice);
        break;
      case 'customer.subscription.updated':
        await this.onSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event.data.object);
        break;
      default:
        this.logger.debug(`Ignoring unhandled event type: ${event.type}`);
    }
  }

  // First payment via a Payment Link. Grants the initial allocation.
  private async onCheckoutCompleted(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const userId = Number(session.client_reference_id);
    if (!Number.isInteger(userId)) {
      this.logger.error(
        `checkout.session.completed with no usable client_reference_id (${session.client_reference_id}); ignoring`,
      );
      return;
    }

    const plan = await this.service.resolvePlan({
      amountCents: session.amount_total,
    });
    if (!plan) {
      this.logger.error(
        `checkout.session.completed: could not resolve a plan for amount ${session.amount_total}; ignoring`,
      );
      return;
    }

    const stripeSubscriptionId = idOf(session.subscription);
    const stripeCustomerId = idOf(session.customer);
    const periodStart = new Date();
    const periodEnd = this.service.cyclePeriodEnd(plan.cycle, periodStart);

    await this.service.runInTransaction(async (tx) => {
      // Guard: if this session already produced a payment, we're done.
      if (session.id) {
        const seen = await tx.payment.findUnique({
          where: { stripeSessionId: session.id },
        });
        if (seen) return;
      }

      // Create or reactivate the subscription.
      let subscription = stripeSubscriptionId
        ? await tx.subscription.findUnique({
            where: { stripeSubscriptionId },
          })
        : null;

      if (subscription) {
        subscription = await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status: SubscriptionStatus.ACTIVE,
            planId: plan.id,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
            lastGrantAt: periodStart,
            // A fresh period, and the grant below is its first allocation.
            grantsIssued: 1,
          },
        });
      } else {
        subscription = await tx.subscription.create({
          data: {
            userId,
            planId: plan.id,
            status: SubscriptionStatus.ACTIVE,
            stripeSubscriptionId,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            lastGrantAt: periodStart,
            grantsIssued: 1,
          },
        });
      }

      // Switching plans creates a second Stripe subscription rather than
      // editing the first, so retire any other live row for this user —
      // otherwise the old tier keeps granting credits alongside the new one.
      await tx.subscription.updateMany({
        where: {
          userId,
          id: { not: subscription.id },
          status: {
            in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
          },
        },
        data: { status: SubscriptionStatus.CANCELED },
      });

      if (stripeCustomerId) {
        await tx.user.update({
          where: { id: userId },
          data: { stripeCustomerId },
        });
      }

      await tx.payment.create({
        data: {
          userId,
          subscriptionId: subscription.id,
          amountCents: session.amount_total ?? plan.priceCents,
          currency: session.currency ?? 'usd',
          status: 'SUCCEEDED',
          description: `${plan.tier} ${plan.cycle} — initial payment`,
          stripeSessionId: session.id,
          stripePaymentIntentId: idOf(session.payment_intent),
          stripeInvoiceId: idOf(session.invoice),
        },
      });

      await this.service.grantCredits(
        userId,
        plan.creditsGranted,
        CreditReason.SUBSCRIPTION_GRANT,
        subscription.id,
        `${plan.tier} ${plan.cycle} initial grant`,
        tx,
      );
    });

    this.logger.log(
      `Granted ${plan.creditsGranted} credits to user ${userId} (${plan.tier} ${plan.cycle}, checkout)`,
    );
  }

  // Renewal invoice. The very first invoice (billing_reason
  // 'subscription_create') is the one already handled by the checkout session,
  // so we skip it to avoid double-granting.
  private async onInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    if (invoice.billing_reason === 'subscription_create') {
      this.logger.debug(
        'invoice.paid for subscription_create — already handled at checkout; skipping',
      );
      return;
    }

    const stripeSubscriptionId = idOf(
      (invoice as unknown as { subscription?: string | { id: string } })
        .subscription,
    );
    if (!stripeSubscriptionId) {
      this.logger.warn('invoice.paid without a subscription id; ignoring');
      return;
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId },
      include: { plan: true },
    });
    if (!subscription) {
      this.logger.warn(
        `invoice.paid for unknown subscription ${stripeSubscriptionId}; ignoring`,
      );
      return;
    }

    const plan = subscription.plan;
    const userId = subscription.userId;
    const now = new Date();
    const periodEnd = this.service.cyclePeriodEnd(plan.cycle, now);

    await this.service.runInTransaction(async (tx) => {
      if (invoice.id) {
        const seen = await tx.payment.findUnique({
          where: { stripeInvoiceId: invoice.id },
        });
        if (seen) return;
      }

      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          lastGrantAt: now,
          // New period — the grant below is allocation 1 of grantsPerPeriod.
          grantsIssued: 1,
        },
      });

      await tx.payment.create({
        data: {
          userId,
          subscriptionId: subscription.id,
          amountCents: invoice.amount_paid ?? plan.priceCents,
          currency: invoice.currency ?? 'usd',
          status: 'SUCCEEDED',
          description: `${plan.tier} ${plan.cycle} — renewal`,
          stripeInvoiceId: invoice.id,
        },
      });

      await this.service.grantCredits(
        userId,
        plan.creditsGranted,
        CreditReason.SUBSCRIPTION_GRANT,
        subscription.id,
        `${plan.tier} ${plan.cycle} renewal grant`,
        tx,
      );
    });

    this.logger.log(
      `Renewal: granted ${plan.creditsGranted} credits to user ${userId} (${plan.tier} ${plan.cycle})`,
    );
  }

  // Failed renewal — mark PAST_DUE, but never revoke already-granted credits.
  private async onInvoiceFailed(invoice: Stripe.Invoice): Promise<void> {
    const stripeSubscriptionId = idOf(
      (invoice as unknown as { subscription?: string | { id: string } })
        .subscription,
    );
    if (!stripeSubscriptionId) return;

    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId },
    });
    if (!subscription) return;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: SubscriptionStatus.PAST_DUE },
    });
    this.logger.warn(
      `Payment failed for subscription ${subscription.id} → PAST_DUE (credits kept)`,
    );
  }

  private async onSubscriptionUpdated(
    sub: Stripe.Subscription,
  ): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: sub.id },
    });
    if (!subscription) {
      this.logger.debug(`subscription.updated for unknown ${sub.id}; ignoring`);
      return;
    }

    const periodEnd = periodEndFromSub(sub);
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: mapStatus(sub.status),
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
      },
    });
    this.logger.log(`Synced subscription ${subscription.id} (${sub.status})`);
  }

  // Cancellation — keep unspent credits, they were paid for.
  private async onSubscriptionDeleted(
    sub: Stripe.Subscription,
  ): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: sub.id },
    });
    if (!subscription) return;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: SubscriptionStatus.CANCELED },
    });
    this.logger.log(`Subscription ${subscription.id} canceled (credits kept)`);
  }
}
