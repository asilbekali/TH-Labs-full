import { Injectable, Logger } from '@nestjs/common';
import { CreditReason, Plan, SubscriptionStatus } from '@prisma/client';
import type DodoPayments from 'dodopayments';

import {
  META_PACK_ID,
  META_PLAN_ID,
  META_USER_ID,
  PaymentService,
} from './payment.service';
import { PrismaService } from '../prisma/prisma.service';
import { DodoService } from './dodo.service';

type Metadata = Record<string, string> | null | undefined;

// Map Dodo's subscription status vocabulary onto ours.
//
// `past_due` is Dodo's grace period — the renewal failed but the customer
// still has access until the deadline — and `on_hold` is what follows when it
// runs out. Both are PAST_DUE here: the tier stays live, credits are kept, and
// the hourly expiry sweep is what eventually drops them to Free.
function mapStatus(
  status: DodoPayments.SubscriptionStatus,
): SubscriptionStatus {
  switch (status) {
    case 'active':
      return SubscriptionStatus.ACTIVE;
    case 'past_due':
    case 'on_hold':
    case 'paused':
      return SubscriptionStatus.PAST_DUE;
    case 'cancelled':
      return SubscriptionStatus.CANCELED;
    case 'expired':
    case 'failed':
      return SubscriptionStatus.EXPIRED;
    case 'pending':
    default:
      return SubscriptionStatus.ACTIVE;
  }
}

function metaValue(metadata: Metadata, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Dispatches verified Dodo Payments events. Idempotency is enforced upstream in
// PaymentController before this runs, via the WebhookEvent unique constraint on
// the `webhook-id` header.
//
// The division of labour between the two event families matters:
//
//   • `payment.succeeded` is the ONLY thing that grants credits. It is the one
//     event that means money actually moved, and it fires uniformly for the
//     first charge and for every renewal — where the subscription events split
//     the same moment across `subscription.active` and `subscription.renewed`.
//   • the `subscription.*` events keep status, period and plan in sync. They
//     never grant, so a mandate that authorises and then fails to charge
//     cannot hand out a month of credits.
@Injectable()
export class DodoWebhookHandler {
  private readonly logger = new Logger(DodoWebhookHandler.name);

  constructor(
    private readonly service: PaymentService,
    private readonly prisma: PrismaService,
    private readonly dodo: DodoService,
  ) {}

  async dispatch(event: DodoPayments.UnwrapWebhookEvent): Promise<void> {
    switch (event.type) {
      case 'payment.succeeded':
        await this.onPaymentSucceeded(event.data);
        break;

      case 'subscription.active':
      case 'subscription.renewed':
      case 'subscription.plan_changed':
      case 'subscription.updated':
      case 'subscription.unpaused':
        await this.syncSubscription(event.data, event.type);
        break;

      case 'subscription.past_due':
      case 'subscription.on_hold':
      case 'subscription.paused':
        await this.onSubscriptionTroubled(event.data, event.type);
        break;

      case 'subscription.cancelled':
      case 'subscription.expired':
      case 'subscription.failed':
        await this.onSubscriptionEnded(event.data, event.type);
        break;

      case 'payment.failed':
        this.logger.warn(
          `payment.failed for ${event.data.payment_id}` +
            (event.data.subscription_id
              ? ` (subscription ${event.data.subscription_id})`
              : '') +
            ` — ${event.data.error_message ?? 'no reason given'}`,
        );
        break;

      default:
        this.logger.debug(`Ignoring unhandled event type: ${event.type}`);
    }
  }

  // ── Identity ────────────────────────────────────────────────────────────
  // Which of our users paid. The metadata we stamped at checkout is the
  // primary route, but on a static payment link that metadata is a query
  // parameter the customer could have edited — so a metadata user id is only
  // trusted when it agrees with the email that actually paid. The email is
  // authoritative because Dodo collected it, not us.
  private async resolveUser(
    metadata: Metadata,
    customer: { email?: string | null } | null | undefined,
  ): Promise<number | null> {
    const claimed = metaValue(metadata, META_USER_ID);
    const email = customer?.email?.trim().toLowerCase();

    const byEmail = email
      ? await this.prisma.user.findUnique({ where: { email } })
      : null;

    if (claimed) {
      const id = Number(claimed);
      if (!Number.isInteger(id)) {
        this.logger.warn(`Ignoring non-numeric ${META_USER_ID} '${claimed}'`);
      } else if (!byEmail || byEmail.id === id) {
        // No email to check against, or it agrees — take the metadata.
        const exists = await this.prisma.user.findUnique({ where: { id } });
        if (exists) return exists.id;
        this.logger.warn(`${META_USER_ID} ${id} does not match any user`);
      } else {
        // They disagree. The payer is whoever Dodo charged, not whoever the
        // link claimed to be — this is exactly the tampering case.
        this.logger.warn(
          `${META_USER_ID} ${id} disagrees with the paying email (user ${byEmail.id}); ` +
            'crediting the payer',
        );
        return byEmail.id;
      }
    }

    if (byEmail) return byEmail.id;

    this.logger.error(
      `Could not attribute a payment to any user (metadata ${META_USER_ID}=` +
        `${claimed ?? 'unset'}, email ${email ?? 'unset'})`,
    );
    return null;
  }

  // ── Money moved ─────────────────────────────────────────────────────────
  private async onPaymentSucceeded(
    payment: DodoPayments.Payment,
  ): Promise<void> {
    const metadata = payment.metadata as Metadata;
    const userId = await this.resolveUser(metadata, payment.customer);
    if (userId === null) return;

    if (payment.customer?.customer_id) {
      await this.prisma.user
        .update({
          where: { id: userId },
          data: { dodoCustomerId: payment.customer.customer_id },
        })
        // A second account paying with the same Dodo customer would collide on
        // the unique index. Not worth failing the grant over.
        .catch(() => undefined);
    }

    if (payment.subscription_id) {
      await this.grantForSubscriptionPayment(userId, payment);
      return;
    }
    await this.grantForCreditPack(userId, payment);
  }

  // A subscription charge: the first one after checkout, or a renewal. Both
  // start a fresh period and hand out allocation 1 of `grantsPerPeriod`.
  private async grantForSubscriptionPayment(
    userId: number,
    payment: DodoPayments.Payment,
  ): Promise<void> {
    const dodoSubscriptionId = payment.subscription_id!;
    const metadata = payment.metadata as Metadata;

    const existing = await this.prisma.subscription.findUnique({
      where: { dodoSubscriptionId },
      include: { plan: true },
    });

    // Read the live subscription for the plan's product and the real next
    // billing date. Without the API key we fall back to the metadata plan and
    // a computed period — both are right for every ordinary purchase.
    const remote = await this.dodo.retrieveSubscription(dodoSubscriptionId);

    const plan: Plan | null =
      existing?.plan ??
      (await this.service.resolvePlan({
        planId:
          metaValue(metadata, META_PLAN_ID) ??
          metaValue(remote?.metadata as Metadata, META_PLAN_ID),
        productId: remote?.product_id,
        amountCents: payment.total_amount,
      }));

    if (!plan) {
      this.logger.error(
        `payment.succeeded ${payment.payment_id}: no plan for subscription ` +
          `${dodoSubscriptionId}; credits NOT granted`,
      );
      return;
    }

    const periodStart = new Date();
    const periodEnd =
      parseDate(remote?.next_billing_date) ??
      this.service.cyclePeriodEnd(plan.cycle, periodStart);

    await this.service.runInTransaction(async (tx) => {
      // Idempotency that survives a replayed event with a fresh webhook-id:
      // one Payment row per Dodo payment id, and the grant rides in the same
      // transaction as the row that guards it.
      const seen = await tx.payment.findUnique({
        where: { dodoPaymentId: payment.payment_id },
      });
      if (seen) return;

      const subscription = existing
        ? await tx.subscription.update({
            where: { id: existing.id },
            data: {
              status: SubscriptionStatus.ACTIVE,
              planId: plan.id,
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
              cancelAtPeriodEnd: remote?.cancel_at_next_billing_date ?? false,
              lastGrantAt: periodStart,
              // A fresh period, and the grant below is its first allocation.
              grantsIssued: 1,
            },
          })
        : await tx.subscription.create({
            data: {
              userId,
              planId: plan.id,
              status: SubscriptionStatus.ACTIVE,
              dodoSubscriptionId,
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
              lastGrantAt: periodStart,
              grantsIssued: 1,
            },
          });

      // Changing plans creates a second Dodo subscription rather than editing
      // the first, so retire any other live row for this user — otherwise the
      // old tier keeps granting credits alongside the new one.
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

      await tx.payment.create({
        data: {
          userId,
          subscriptionId: subscription.id,
          amountCents: payment.total_amount,
          currency: (payment.currency ?? 'USD').toLowerCase(),
          status: 'SUCCEEDED',
          description: `${plan.tier} ${plan.cycle} — ${existing ? 'renewal' : 'initial payment'}`,
          dodoPaymentId: payment.payment_id,
          dodoCheckoutSessionId: payment.checkout_session_id ?? null,
          dodoInvoiceId: payment.invoice_id ?? null,
        },
      });

      await this.service.grantCredits(
        userId,
        plan.creditsGranted,
        CreditReason.SUBSCRIPTION_GRANT,
        subscription.id,
        `${plan.tier} ${plan.cycle} ${existing ? 'renewal' : 'initial'} grant`,
        tx,
      );
    });

    this.logger.log(
      `Granted ${plan.creditsGranted} credits to user ${userId} ` +
        `(${plan.tier} ${plan.cycle}, ${existing ? 'renewal' : 'checkout'})`,
    );
  }

  // A one-time credit pack. No subscription, no period — credits land and the
  // transaction is over.
  private async grantForCreditPack(
    userId: number,
    payment: DodoPayments.Payment,
  ): Promise<void> {
    const metadata = payment.metadata as Metadata;
    const slug = metaValue(metadata, META_PACK_ID);

    // Resolve by the slug we stamped at checkout, and fall back to the product
    // that was actually bought. The fallback matters for a static payment link
    // shared directly (no metadata at all) and for a deactivated pack: someone
    // who has already paid must still get their credits.
    const productId = payment.product_cart?.[0]?.product_id ?? null;
    const pack =
      (slug
        ? await this.prisma.creditPack.findUnique({ where: { slug } })
        : null) ??
      (productId
        ? await this.prisma.creditPack.findUnique({
            where: { dodoProductId: productId },
          })
        : null);

    if (!pack) {
      this.logger.error(
        `payment.succeeded ${payment.payment_id}: one-time payment matching no ` +
          `credit pack (${META_PACK_ID}='${slug ?? 'unset'}', product ` +
          `'${productId ?? 'unset'}'); credits NOT granted`,
      );
      return;
    }

    await this.service.runInTransaction(async (tx) => {
      const seen = await tx.payment.findUnique({
        where: { dodoPaymentId: payment.payment_id },
      });
      if (seen) return;

      await tx.payment.create({
        data: {
          userId,
          amountCents: payment.total_amount,
          currency: (payment.currency ?? 'USD').toLowerCase(),
          status: 'SUCCEEDED',
          description: `${pack.credits} credits — one-time pack`,
          dodoPaymentId: payment.payment_id,
          dodoCheckoutSessionId: payment.checkout_session_id ?? null,
          dodoInvoiceId: payment.invoice_id ?? null,
        },
      });

      await this.service.grantCredits(
        userId,
        pack.credits,
        CreditReason.PACK_PURCHASE,
        payment.payment_id,
        `${pack.slug} purchase`,
        tx,
      );
    });

    this.logger.log(
      `Granted ${pack.credits} credits to user ${userId} (${pack.slug}, one-time)`,
    );
  }

  // ── Lifecycle sync (never grants) ───────────────────────────────────────
  private async syncSubscription(
    sub: DodoPayments.Subscription,
    type: string,
  ): Promise<void> {
    const existing = await this.prisma.subscription.findUnique({
      where: { dodoSubscriptionId: sub.subscription_id },
    });

    const periodEnd = parseDate(sub.next_billing_date);
    const plan = await this.service.resolvePlan({
      planId: metaValue(sub.metadata as Metadata, META_PLAN_ID),
      productId: sub.product_id,
      amountCents: sub.recurring_pre_tax_amount,
    });

    if (!existing) {
      // The row is normally created by payment.succeeded. Arriving here first
      // is the expected order (the charge follows within minutes), so seed the
      // row now with NO grant — the payment event hands out the credits and
      // resets grantsIssued to 1 when it lands.
      const userId = await this.resolveUser(
        sub.metadata as Metadata,
        sub.customer,
      );
      if (userId === null || !plan) {
        this.logger.warn(
          `${type} for unknown subscription ${sub.subscription_id}; ignoring`,
        );
        return;
      }
      const periodStart = parseDate(sub.previous_billing_date) ?? new Date();
      await this.prisma.subscription.create({
        data: {
          userId,
          planId: plan.id,
          status: mapStatus(sub.status),
          dodoSubscriptionId: sub.subscription_id,
          currentPeriodStart: periodStart,
          currentPeriodEnd:
            periodEnd ?? this.service.cyclePeriodEnd(plan.cycle, periodStart),
          cancelAtPeriodEnd: sub.cancel_at_next_billing_date,
          grantsIssued: 0,
        },
      });
      this.logger.log(
        `${type}: opened subscription ${sub.subscription_id} for user ${userId} ` +
          `(${plan.tier} ${plan.cycle}) — awaiting payment.succeeded to grant`,
      );
      return;
    }

    await this.prisma.subscription.update({
      where: { id: existing.id },
      data: {
        status: mapStatus(sub.status),
        cancelAtPeriodEnd: sub.cancel_at_next_billing_date,
        // A plan change swaps the product mid-subscription; follow it so the
        // next renewal grants the new tier's allocation.
        ...(plan ? { planId: plan.id } : {}),
        ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
      },
    });
    this.logger.log(
      `${type}: synced subscription ${existing.id} (${sub.status})`,
    );
  }

  // A renewal failed, or the customer paused. Access and credits are kept —
  // they were paid for — and the hourly sweep expires the row if the period
  // runs out without a recovery.
  private async onSubscriptionTroubled(
    sub: DodoPayments.Subscription & { past_due_ends_at?: string | null },
    type: string,
  ): Promise<void> {
    const existing = await this.prisma.subscription.findUnique({
      where: { dodoSubscriptionId: sub.subscription_id },
    });
    if (!existing) {
      this.logger.debug(`${type} for unknown ${sub.subscription_id}; ignoring`);
      return;
    }

    // A grace period is a real deadline: hold the tier open until it, not
    // until a next_billing_date that will never be charged.
    const graceEnd = parseDate(sub.past_due_ends_at);

    await this.prisma.subscription.update({
      where: { id: existing.id },
      data: {
        status: SubscriptionStatus.PAST_DUE,
        ...(graceEnd ? { currentPeriodEnd: graceEnd } : {}),
      },
    });
    this.logger.warn(
      `${type} for subscription ${existing.id} → PAST_DUE (credits kept` +
        (graceEnd ? `, access until ${graceEnd.toISOString()}` : '') +
        ')',
    );
  }

  // Ended for good. Unspent credits are deliberately left alone: they were
  // paid for, and the cancel endpoint makes the same promise.
  private async onSubscriptionEnded(
    sub: DodoPayments.Subscription,
    type: string,
  ): Promise<void> {
    const existing = await this.prisma.subscription.findUnique({
      where: { dodoSubscriptionId: sub.subscription_id },
    });
    if (!existing) {
      this.logger.debug(`${type} for unknown ${sub.subscription_id}; ignoring`);
      return;
    }

    const status =
      type === 'subscription.cancelled'
        ? SubscriptionStatus.CANCELED
        : SubscriptionStatus.EXPIRED;

    await this.prisma.subscription.update({
      where: { id: existing.id },
      data: { status },
    });
    this.logger.log(
      `${type}: subscription ${existing.id} → ${status} (credits kept)`,
    );
  }
}
