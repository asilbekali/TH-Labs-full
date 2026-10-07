import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BillingCycle,
  CreditPack,
  CreditReason,
  Plan,
  PlanTier,
  Prisma,
  PrismaClient,
  Subscription,
  SubscriptionStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  LemonSqueezyService,
  LemonSqueezyUnavailableError,
  type LsInvoice,
  type LsOrder,
  type LsSubscription,
} from './lemonsqueezy.service';
import { CanDubDto, CanDubResult } from './dto/can-dub.dto';
import { CommitDubDto, CommitDubResult } from './dto/commit-dub.dto';
import {
  PaymentRequiredException,
  PlanUpgradeRequiredException,
} from './payment-required.exception';
import {
  PLAN_FEATURES,
  TIER_DISPLAY_NAME,
  TURKIC_LANGUAGES,
  checkFeatures,
} from './plan-features';
import {
  CREDITS_PER_MINUTE,
  CREDITS_PER_MINUTE_BY_QUALITY,
  FREE_MINUTE_SECONDS,
  QUALITY_MULTIPLIER,
  SIGNUP_BONUS_CREDITS,
  affordableSeconds,
  costForDub,
  rateFor,
} from './quality-cost';

// A Prisma transaction client — the subset of the client available inside
// `$transaction(async (tx) => …)`.
type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** What one claimed order or renewal paid out. */
export interface GrantedPurchase {
  orderId: string;
  description: string;
  creditsGranted: number;
}

// How long a subscription paid through Lemon Squeezy is kept on its tier past
// the end of its period while LS has not yet billed the renewal. LS charges at
// `renews_at` and retries a failed card for several days; dropping the user to
// Free in that window, then back again an hour later, would be wrong in both
// directions. The renewal sync marks it EXPIRED the moment LS says it is.
const LS_RENEWAL_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

// Orders older than the account are never claimed by it. An email freed by a
// deleted account and registered again must not inherit that account's
// purchases. A few minutes of slack absorb clock skew between LS and the DB.
const ORDER_CLOCK_SKEW_MS = 10 * 60 * 1000;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ls: LemonSqueezyService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  // The free allowance is no longer a special-cased "one free dub of up to N
  // seconds". A new account is simply given SIGNUP_BONUS_CREDITS, which buys
  // exactly this many seconds at Balanced quality. Reported to clients so the
  // pricing page can state the offer without hardcoding it.
  private get freeMinuteSeconds(): number {
    return FREE_MINUTE_SECONDS;
  }

  private get appUrl(): string {
    return (
      this.config.get<string>('APP_URL')?.trim() || 'http://localhost:5173'
    );
  }

  /**
   * Where every Lemon Squeezy product should send the buyer after paying.
   *
   * Reported to the admin panel (`GET /v1/admin/billing/overview`) so it can be
   * copied rather than remembered. Set it on each product in the LS dashboard
   * under "Confirmation modal → Button link" (or the product's redirect URL).
   *
   * It carries no order id — LS does not add one — and it does not need to:
   * the success page asks the API to look the account's orders up. If it is
   * missing, nothing is lost either; the buyer just is not brought
   * back, and the cron credits the order within a few minutes.
   */
  get successUrl(): string {
    return `${this.appUrl.replace(/\/$/, '')}/plans/success`;
  }

  // ── Catalog ────────────────────────────────────────────────────────────
  async getPlans() {
    const plans = await this.prisma.plan.findMany({
      where: { active: true },
      orderBy: [{ priceCents: 'asc' }],
    });

    // A paid plan is buyable only once it has BOTH a checkout link to open and
    // the variant id a paid order is matched on. Either alone takes money that
    // could not be credited.
    const paid = plans.filter((p) => p.tier !== PlanTier.FREE);
    const unconfigured = paid.filter((p) => !this.isSellable(p));

    return {
      plans,
      // Per-MINUTE price list now, not a flat per-dub cost.
      qualityCost: CREDITS_PER_MINUTE_BY_QUALITY,
      creditsPerMinute: CREDITS_PER_MINUTE,
      qualityMultiplier: QUALITY_MULTIPLIER,
      freeMinuteSeconds: this.freeMinuteSeconds,
      signupBonusCredits: SIGNUP_BONUS_CREDITS,
      /** What each tier may use in the Studio. See plan-features.ts. */
      features: PLAN_FEATURES,
      /** Customer-facing tier names (STUDIO is sold as "Studio Max"). */
      tierNames: TIER_DISPLAY_NAME,
      turkicLanguages: TURKIC_LANGUAGES,
      checkout: {
        provider: 'lemonsqueezy' as const,
        /**
         * 'test' | 'live' read off the catalog's own LS variants, so a live
         * site still selling test products is visible on the page.
         * 'unknown' when LS could not be asked; 'unconfigured' with no key.
         */
        mode: await this.checkoutMode(paid),
        /** True when at least one paid plan can be bought. */
        configured: paid.length > unconfigured.length,
        /** `TIER/CYCLE` for every paid plan missing its link or variant id. */
        missingProducts: unconfigured.map((p) => `${p.tier}/${p.cycle}`),
        /**
         * False when LEMONSQUEEZY_API_KEY is unset. A purchase then cannot be
         * verified, so it cannot be credited — the UI disables Buy rather than
         * taking money it has no way to honour.
         */
        canGrantCredits: this.ls.configured,
      },
    };
  }

  private async checkoutMode(
    plans: Plan[],
  ): Promise<'test' | 'live' | 'unknown' | 'unconfigured'> {
    if (!this.ls.configured) return 'unconfigured';
    const variant = plans.find((p) => this.isSellable(p))?.lsVariantId;
    if (!variant) return 'unknown';
    const test = await this.ls.variantTestMode(variant);
    return test === null ? 'unknown' : test ? 'test' : 'live';
  }

  private isSellable(row: { checkoutUrl: string | null; lsVariantId: string | null }) {
    return !!row.checkoutUrl && !!row.lsVariantId;
  }

  // ── One-time credit packs ──────────────────────────────────────────────
  // The catalog is the CreditPack table, managed from the admin panel. A pack
  // that cannot be bought yet is still listed — the price is real information —
  // but is marked unavailable so the page can disable its button instead of
  // failing on click.
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
        available: this.isSellable(pack) && this.ls.configured,
      })),
      creditsPerMinute: CREDITS_PER_MINUTE,
      qualityMultiplier: QUALITY_MULTIPLIER,
    };
  }

  // ── Checkout: a hand-made Lemon Squeezy share link ─────────────────────
  //
  // No checkout is created here and no card data ever reaches this origin. An
  // admin makes each product in the LS dashboard and pastes its share link
  // into the admin panel; these endpoints hand that link to the browser with
  // the account's email prefilled.
  //
  // The email is what ties the order back to this account (see claimOrders),
  // so it is prefilled rather than left to the buyer. The user id also rides
  // along as custom data: nothing reads it today, but it is exactly what a
  // future webhook needs, and it costs nothing to send now.
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
    if (!this.isSellable(plan)) {
      throw new BadRequestException(
        `${tier} ${cycle} has no Lemon Squeezy checkout link or variant id yet. ` +
          'Set both in the admin panel (PATCH /v1/admin/billing/plans/:id).',
      );
    }

    return {
      url: await this.checkoutLinkFor(userId, plan.checkoutUrl!, {
        kind: 'plan',
        item: `${plan.tier}_${plan.cycle}`,
      }),
      tier: plan.tier,
      cycle: plan.cycle,
      priceCents: plan.priceCents,
      creditsGranted: plan.creditsGranted,
    };
  }

  /** The same, for a one-time credit pack. No subscription is created. */
  async getCreditCheckoutUrl(userId: number, packSlug: string) {
    const pack = await this.prisma.creditPack.findUnique({
      where: { slug: packSlug },
    });
    if (!pack || !pack.active) {
      throw new BadRequestException(
        `Unknown or inactive credit pack '${packSlug}'.`,
      );
    }
    if (!this.isSellable(pack)) {
      throw new BadRequestException(
        `${pack.slug} has no Lemon Squeezy checkout link or variant id yet. ` +
          'Set both in the admin panel.',
      );
    }

    return {
      url: await this.checkoutLinkFor(userId, pack.checkoutUrl!, {
        kind: 'pack',
        item: pack.slug,
      }),
      packId: pack.slug,
      credits: pack.credits,
      priceCents: pack.priceCents,
    };
  }

  /**
   * The share link, tagged for this account — and the moment the cron starts
   * watching for this account's order.
   *
   * Refuses outright when LEMONSQUEEZY_API_KEY is unset: there would be no way
   * to see the order, so the money would leave the customer's card and nothing
   * would arrive. A 503 in front of the Buy button is a bug report; a silent
   * charge with no credits is a refund and a lost user.
   */
  private async checkoutLinkFor(
    userId: number,
    link: string,
    custom: { kind: 'plan' | 'pack'; item: string },
  ): Promise<string> {
    if (!this.ls.configured) {
      this.logger.error(
        'Refusing checkout: LEMONSQUEEZY_API_KEY is not set, so a completed ' +
          'payment could not be verified and no credits could be granted.',
      );
      throw new ServiceUnavailableException(
        'Payments are temporarily unavailable — the server cannot confirm a ' +
          'purchase right now, so no charge has been made.',
      );
    }

    let url: URL;
    try {
      url = new URL(link);
    } catch {
      // An admin pasted something that is not a URL. Caught here rather than
      // handed to the browser, where it would be a silent dead link.
      this.logger.error(`Plan/pack has an unparseable checkout link: ${link}`);
      throw new ServiceUnavailableException(
        'This item is misconfigured and cannot be bought right now.',
      );
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      // Starts the 24-hour window in which the cron looks for this account's
      // order, so a buyer who pays and closes the tab is still credited.
      data: { lsCheckoutStartedAt: new Date() },
      select: { email: true, name: true },
    });

    // The email is how the order is found again — see claimOrders. A buyer can
    // still change it on the LS form; the success page says to keep it.
    url.searchParams.set('checkout[email]', user.email);
    if (user.name) url.searchParams.set('checkout[name]', user.name);
    url.searchParams.set('checkout[custom][user_id]', String(userId));
    url.searchParams.set('checkout[custom][kind]', custom.kind);
    url.searchParams.set('checkout[custom][item]', custom.item);
    return url.toString();
  }

  // ── Claiming purchases ─────────────────────────────────────────────────
  /**
   * Turn this account's paid Lemon Squeezy orders into credits. The only path
   * that grants credits for money.
   *
   * Called by /plans/success when the buyer comes back, and by the cron for
   * anyone who opened a checkout in the last day. It asks LS for the orders
   * placed with this account's email and acts only on what LS reports:
   *
   *   paid?     the order's `status`, from LS. Pending, failed, refunded or
   *             fraudulent orders grant nothing.
   *   what?     the order's VARIANT id, from LS, matched against
   *             Plan/CreditPack.lsVariantId. The share link fixes it and the
   *             buyer cannot change it, so there is no way to pay for 100
   *             credits and be granted 2 000. A variant that matches nothing
   *             grants nothing and is logged.
   *   who?      the order's email, which must be this account's — LS only
   *             returns orders filed under it. Emails are unique here, and an
   *             order older than the account is ignored.
   *
   * Idempotent on the order id, enforced by the UNIQUE index on
   * `Payment.lsOrderId` rather than by a check-then-write: the row and the
   * grant are one transaction, so the success page, a reload and the cron
   * racing each other all pay out exactly once.
   */
  async claimOrders(userId: number) {
    if (!this.ls.configured) {
      throw new ServiceUnavailableException(
        'Purchases cannot be confirmed right now. Your payment is safe — ' +
          'reload this page in a few minutes, or contact support.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, createdAt: true },
    });
    if (!user) throw new NotFoundException('User not found.');

    let orders: LsOrder[];
    try {
      orders = await this.ls.listOrdersByEmail(user.email);
    } catch (error) {
      if (error instanceof LemonSqueezyUnavailableError) {
        // Ours, not theirs, and temporary — so 503 and "try again", never a
        // message implying the payment did not happen.
        throw new ServiceUnavailableException(
          'We could not reach Lemon Squeezy to confirm your payment. Your ' +
            'money is safe — reload this page in a moment.',
        );
      }
      throw error;
    }

    const notBefore = user.createdAt.getTime() - ORDER_CLOCK_SKEW_MS;
    // Oldest first: if two plans were bought, the newer one ends up current.
    const candidates = orders
      .filter((o) => o.createdAt.getTime() >= notBefore)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const known = new Set(
      (
        await this.prisma.payment.findMany({
          where: { lsOrderId: { in: candidates.map((o) => o.id) } },
          select: { lsOrderId: true },
        })
      ).map((p) => p.lsOrderId),
    );

    const granted: GrantedPurchase[] = [];
    let pending = 0;
    let unmatched = 0;

    for (const order of candidates) {
      if (known.has(order.id)) continue;
      if (!order.paid) {
        if (order.status === 'pending') pending++;
        continue;
      }

      const item = await this.resolveVariant(order.variantId);
      if (!item) {
        unmatched++;
        this.logger.error(
          `Order ${order.id} (#${order.orderNumber}) for user ${userId} is PAID ` +
            `but its variant ${order.variantId ?? 'none'} ` +
            `("${order.productName ?? '?'} / ${order.variantName ?? '?'}") is not ` +
            'attached to any plan or credit pack. Credits NOT granted. Set ' +
            'lsVariantId on the right row in the admin panel; the next claim or ' +
            'cron run will credit it.',
        );
        continue;
      }

      try {
        granted.push(
          item.kind === 'plan'
            ? await this.grantPlanOrder(userId, item.plan, order)
            : await this.grantPackOrder(userId, item.pack, order),
        );
      } catch (error) {
        // Another claim of the same order (the cron, a second tab) won the
        // race and has already credited it. Exactly the outcome wanted.
        if (isUniqueViolation(error)) continue;
        if (error instanceof LemonSqueezyUnavailableError) {
          throw new ServiceUnavailableException(
            'We could not reach Lemon Squeezy to finish confirming your ' +
              'payment. Your money is safe — reload this page in a moment.',
          );
        }
        throw error;
      }
    }

    const { credits } = await this.getCreditSummary(userId);
    const { subscription } = await this.getSubscription(userId);
    // Purchases credited in the last hour — by this call OR by an earlier one,
    // such as the cron finishing before the buyer got back to the site. Lets
    // the success page say "done" instead of "nothing found" in that case.
    const recent = await this.prisma.payment.findMany({
      where: {
        userId,
        status: 'SUCCEEDED',
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
      select: { description: true, createdAt: true },
    });

    return {
      claimed: granted.length > 0,
      granted,
      creditsGranted: granted.reduce((sum, g) => sum + g.creditsGranted, 0),
      balance: credits,
      /** LS has an order still processing — worth asking again shortly. */
      pending: pending > 0,
      /** Paid orders that match no catalog row. Support has to settle these. */
      unmatched,
      recent,
      subscription,
    };
  }

  // ── Webhook: credit the moment LS says it is paid ─────────────────────
  /**
   * `POST /payments/webhook`. The webhook is a doorbell, not the source of
   * truth: a correctly signed event only tells us WHICH account to look at,
   * and the credits then come from claimOrders / syncRenewals, which read the
   * order back from the LS API exactly as the success page does. So the
   * webhook, the success page and the cron share one grant path and one UNIQUE
   * order id, and however many of them fire, every order pays out once.
   *
   * Throws 503 when LS could not be asked, so LS retries the delivery.
   */
  async handleWebhook(payload: unknown): Promise<{ ok: true; handled: string }> {
    const body = (payload ?? {}) as {
      meta?: { event_name?: string; custom_data?: Record<string, unknown> };
      data?: { id?: string; type?: string; attributes?: Record<string, unknown> };
    };
    const event = body.meta?.event_name ?? 'unknown';
    const attrs = body.data?.attributes ?? {};

    if (event === 'order_created' || event === 'subscription_created') {
      const userId = await this.webhookUser(
        body.meta?.custom_data?.user_id,
        attrs.user_email,
      );
      if (!userId) {
        this.logger.warn(
          `LS webhook ${event}: no account for user_id=` +
            `${String(body.meta?.custom_data?.user_id)} / email=${String(attrs.user_email)}. ` +
            'Not credited — support can settle it from the LS receipt.',
        );
        return { ok: true, handled: 'no-account' };
      }
      const result = await this.claimOrders(userId);
      this.logger.log(
        `LS webhook ${event}: user ${userId} — ${
          result.claimed
            ? `credited ${result.creditsGranted}`
            : result.pending
              ? 'order still pending'
              : 'nothing new'
        }`,
      );
      return { ok: true, handled: 'claimed' };
    }

    if (event.startsWith('subscription_')) {
      // Renewals (subscription_payment_success) and status changes
      // (cancelled / expired / past_due). The subscription id is the resource
      // id for subscription_* events and an attribute on invoice events.
      const lsSubId =
        body.data?.type === 'subscriptions'
          ? body.data.id
          : attrs.subscription_id != null
            ? String(attrs.subscription_id)
            : undefined;
      const sub = lsSubId
        ? await this.prisma.subscription.findUnique({
            where: { lsSubscriptionId: lsSubId },
            include: { plan: true },
          })
        : null;
      if (!sub) return { ok: true, handled: 'unknown-subscription' };
      try {
        await this.syncRenewals(sub);
      } catch (error) {
        if (error instanceof LemonSqueezyUnavailableError) {
          throw new ServiceUnavailableException('Lemon Squeezy unreachable.');
        }
        throw error;
      }
      return { ok: true, handled: 'synced' };
    }

    return { ok: true, handled: 'ignored' };
  }

  // ── Store sweep: nothing paid is left uncredited ─────────────────────────
  /**
   * Credit every paid order in the store from the last `windowMs` that has not
   * been credited yet, whoever placed it and however they reached checkout.
   *
   * This is the safety net under the success page and the webhook. The old
   * one only watched accounts that had opened a checkout through this API in
   * the last day, so a buyer who reached the LS link another way, or whose
   * order was confirmed after the success page stopped asking, was never
   * credited. One LS request lists the whole window; only accounts with a new
   * paid order are then claimed, through the same idempotent claimOrders.
   */
  async sweepStoreOrders(windowMs: number): Promise<{
    checked: number;
    credited: number;
    noAccount: number;
  }> {
    if (!this.ls.configured) return { checked: 0, credited: 0, noAccount: 0 };

    const orders = (
      await this.ls.listRecentOrders(new Date(Date.now() - windowMs))
    ).filter((o) => o.paid);
    if (orders.length === 0) return { checked: 0, credited: 0, noAccount: 0 };

    const done = new Set(
      (
        await this.prisma.payment.findMany({
          where: { lsOrderId: { in: orders.map((o) => o.id) } },
          select: { lsOrderId: true },
        })
      ).map((p) => p.lsOrderId),
    );
    const open = orders.filter((o) => !done.has(o.id));

    // One claim per account, however many new orders it has.
    const emails = [...new Set(open.map((o) => o.userEmail.trim().toLowerCase()))];
    let credited = 0;
    let noAccount = 0;
    for (const email of emails) {
      const userId = await this.webhookUser(undefined, email);
      if (!userId) {
        noAccount++;
        this.logger.warn(
          `Paid LS order(s) for ${email} match no account — not credited. ` +
            'The buyer used an email with no TH-Labs account; support can settle it.',
        );
        continue;
      }
      try {
        const result = await this.claimOrders(userId);
        if (result.claimed) {
          credited++;
          this.logger.log(
            `Sweep credited user ${userId} with ${result.creditsGranted} credits ` +
              `(${result.granted.map((g) => g.description).join('; ')})`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `Sweep claim for user ${userId} failed, will retry: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return { checked: open.length, credited, noAccount };
  }

  /** The account a webhook is about: our own user id from the checkout link, else the order email. */
  private async webhookUser(
    customUserId: unknown,
    email: unknown,
  ): Promise<number | null> {
    const id = Number(customUserId);
    if (Number.isInteger(id) && id > 0) {
      const user = await this.prisma.user.findUnique({
        where: { id },
        select: { id: true },
      });
      if (user) return user.id;
    }
    if (typeof email === 'string' && email.includes('@')) {
      const user = await this.prisma.user.findFirst({
        where: { email: { equals: email.trim(), mode: 'insensitive' } },
        select: { id: true },
      });
      if (user) return user.id;
    }
    return null;
  }

  /** Which catalog row an LS variant sells. Inactive rows still count — a paid order is a paid order. */
  private async resolveVariant(
    variantId: string | null,
  ): Promise<
    { kind: 'plan'; plan: Plan } | { kind: 'pack'; pack: CreditPack } | null
  > {
    if (!variantId) return null;
    const [plan, pack] = await Promise.all([
      this.prisma.plan.findUnique({ where: { lsVariantId: variantId } }),
      this.prisma.creditPack.findUnique({ where: { lsVariantId: variantId } }),
    ]);
    if (plan) return { kind: 'plan', plan };
    if (pack) return { kind: 'pack', pack };
    return null;
  }

  /**
   * Log — never refuse — when LS charged a different amount from the catalog.
   *
   * Not a refusal, because the amount proves nothing here: the item is the
   * variant LS reports, which the buyer cannot alter, and LS converts
   * the price into the buyer's currency — so the amount is never exact, and a
   * discount code is a legitimate reason for it to be lower. Refusing would
   * take money and grant nothing. A large gap is still worth a human's look.
   */
  private checkAmount(order: LsOrder, expectedCents: number, label: string) {
    if (expectedCents <= 0 || order.totalUsd <= 0) return;
    const drift = Math.abs(order.totalUsd - expectedCents) / expectedCents;
    if (drift > 0.1) {
      this.logger.warn(
        `Order ${order.id}: ${label} is listed at ${expectedCents}c but LS ` +
          `charged ${order.totalUsd}c USD (${order.total} ${order.currency}). ` +
          'Credited anyway (the variant is authoritative). Check the product ' +
          'price in Lemon Squeezy, or the discount used.',
      );
    }
  }

  /** A subscription plan: open a paid period, and grant its first allocation. */
  private async grantPlanOrder(
    userId: number,
    plan: Plan,
    order: LsOrder,
  ): Promise<GrantedPurchase> {
    this.checkAmount(order, plan.priceCents, `${plan.tier} ${plan.cycle}`);

    // The LS subscription this order opened. Needed BEFORE granting: it is what
    // the renewal sync follows, and a plan credited without it would never
    // have its renewals credited. If LS cannot be asked, the order stays
    // unclaimed and the next attempt picks it up.
    const lsSub = await this.ls.getSubscriptionForOrder(order.id);
    if (!lsSub) {
      this.logger.warn(
        `Order ${order.id} bought ${plan.tier} ${plan.cycle} but LS reports no ` +
          'subscription for it — is that product set up as a one-time ' +
          'payment? Crediting one period; renewals cannot be tracked.',
      );
    }

    const periodStart = order.createdAt;
    const periodEnd = this.periodEndFor(plan.cycle, periodStart, lsSub);
    const description = `${TIER_DISPLAY_NAME[plan.tier]} ${plan.cycle} — ${plan.creditsGranted} credits`;

    const result = await this.prisma.transaction(async (tx) => {
      // One live subscription per user. Buying a different tier retires the old
      // row rather than leaving two of them granting credits in parallel.
      const existing = await tx.subscription.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });

      const fields = {
        planId: plan.id,
        status: SubscriptionStatus.ACTIVE,
        lsSubscriptionId: lsSub?.id ?? null,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        lastGrantAt: new Date(),
        // A fresh period; the grant below is its first allocation.
        grantsIssued: 1,
      };
      const subscription = existing
        ? await tx.subscription.update({ where: { id: existing.id }, data: fields })
        : await tx.subscription.create({ data: { userId, ...fields } });

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

      // The idempotency row. UNIQUE on lsOrderId, written in the same
      // transaction as the grant, so a second claim of this order rolls the
      // grant back with it.
      await tx.payment.create({
        data: {
          userId,
          subscriptionId: subscription.id,
          amountCents: order.totalUsd || plan.priceCents,
          currency: 'usd',
          status: 'SUCCEEDED',
          description,
          lsOrderId: order.id,
          lsOrderIdentifier: order.identifier,
        },
      });

      const balance = await this.applyCredits(
        tx,
        userId,
        plan.creditsGranted,
        CreditReason.SUBSCRIPTION_GRANT,
        subscription.id,
        `${plan.tier} ${plan.cycle} grant (order #${order.orderNumber})`,
      );

      return {
        subscription,
        balance,
        replacedLsSubscriptionId:
          existing?.lsSubscriptionId &&
          existing.lsSubscriptionId !== lsSub?.id &&
          (existing.status === SubscriptionStatus.ACTIVE ||
            existing.status === SubscriptionStatus.PAST_DUE)
            ? existing.lsSubscriptionId
            : null,
      };
    }, `grantPlanOrder(${order.id})`);

    this.logger.log(
      `Granted ${plan.creditsGranted} credits to user ${userId} ` +
        `(${plan.tier} ${plan.cycle}, LS order ${order.id})`,
    );

    await this.rememberCustomer(userId, order.customerId);
    this.emailReceipt(userId, {
      description,
      creditsGranted: plan.creditsGranted,
      balance: result.balance,
      amountCents: order.totalUsd || plan.priceCents,
      reference: `LS order #${order.orderNumber}`,
      receiptUrl: order.receiptUrl,
    });

    // Switching plans: the old LS subscription would otherwise keep charging
    // the card for a plan this account no longer has. Cancelled at LS, which
    // lets it run to the end of what was already paid. Best effort — the new
    // plan is credited either way, and a failure is logged for support.
    if (result.replacedLsSubscriptionId) {
      try {
        await this.ls.cancelSubscription(result.replacedLsSubscriptionId);
        this.logger.log(
          `Cancelled replaced LS subscription ${result.replacedLsSubscriptionId} ` +
            `for user ${userId}`,
        );
      } catch (error) {
        this.logger.error(
          `User ${userId} switched plans but LS subscription ` +
            `${result.replacedLsSubscriptionId} could not be cancelled: ` +
            `${error instanceof Error ? error.message : String(error)}. ` +
            'Cancel it in the Lemon Squeezy dashboard or they will be billed twice.',
        );
      }
    }

    return {
      orderId: order.id,
      description,
      creditsGranted: plan.creditsGranted,
    };
  }

  /** A one-time credit pack. No subscription, no period — credits land and it is done. */
  private async grantPackOrder(
    userId: number,
    pack: CreditPack,
    order: LsOrder,
  ): Promise<GrantedPurchase> {
    this.checkAmount(order, pack.priceCents, pack.slug);
    const description = `${pack.credits} credits — one-time pack`;

    const balance = await this.prisma.transaction(async (tx) => {
      await tx.payment.create({
        data: {
          userId,
          amountCents: order.totalUsd || pack.priceCents,
          currency: 'usd',
          status: 'SUCCEEDED',
          description,
          lsOrderId: order.id,
          lsOrderIdentifier: order.identifier,
        },
      });
      return this.applyCredits(
        tx,
        userId,
        pack.credits,
        CreditReason.PACK_PURCHASE,
        order.id,
        `${pack.slug} purchase (order #${order.orderNumber})`,
      );
    }, `grantPackOrder(${order.id})`);

    this.logger.log(
      `Granted ${pack.credits} credits to user ${userId} ` +
        `(${pack.slug}, LS order ${order.id})`,
    );
    await this.rememberCustomer(userId, order.customerId);
    this.emailReceipt(userId, {
      description,
      creditsGranted: pack.credits,
      balance,
      amountCents: order.totalUsd || pack.priceCents,
      reference: `LS order #${order.orderNumber}`,
      receiptUrl: order.receiptUrl,
    });

    return { orderId: order.id, description, creditsGranted: pack.credits };
  }

  /**
   * The receipt email. Fire-and-forget, after the grant has committed: it only
   * ever runs once per order (the grant is UNIQUE on it), and a mail failure
   * must never turn a credited purchase into an error for the buyer.
   */
  private emailReceipt(
    userId: number,
    payment: Parameters<MailService['sendPaymentReceipt']>[2],
  ): void {
    void (async () => {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      });
      if (!user) return;
      await this.mail.sendPaymentReceipt(
        user.email,
        user.name || user.email.split('@')[0],
        payment,
      );
    })().catch((error) =>
      this.logger.error(
        `Receipt email for user ${userId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    );
  }

  /** Outside the grant transaction on purpose: it is bookkeeping, and must never fail a paid claim. */
  private async rememberCustomer(userId: number, customerId: string | null) {
    if (!customerId) return;
    await this.prisma.user
      .update({ where: { id: userId }, data: { lsCustomerId: customerId } })
      .catch(() => undefined);
  }

  /**
   * End of a paid period. LS's own `renews_at` when it has one — it is the
   * moment LS will bill again, so the renewal sync and the period agree — and
   * otherwise the calendar step from the purchase.
   */
  private periodEndFor(
    cycle: BillingCycle,
    from: Date,
    lsSub: LsSubscription | null,
  ): Date {
    if (lsSub?.renewsAt && lsSub.renewsAt.getTime() > from.getTime()) {
      return lsSub.renewsAt;
    }
    return this.cyclePeriodEnd(cycle, from);
  }

  // ── Renewals ───────────────────────────────────────────────────────────
  /**
   * Credit the renewals LS has charged on one subscription, and bring its
   * status in line with LS's.
   *
   * A renewal is not an order — LS records it as a subscription invoice with
   * `billing_reason: 'renewal'` — so claimOrders never sees it. Without this,
   * a monthly customer would be charged every month and credited once. Run by
   * the cron for every subscription at or near the end of its period.
   *
   * Idempotent on the invoice id (UNIQUE `Payment.lsInvoiceId`), the same way
   * claims are on the order id.
   */
  async syncRenewals(
    sub: Subscription & { plan: Plan },
  ): Promise<GrantedPurchase[]> {
    if (!sub.lsSubscriptionId || !this.ls.configured) return [];

    const lsSub = await this.ls.getSubscription(sub.lsSubscriptionId);
    const invoices = (await this.ls.listInvoices(sub.lsSubscriptionId))
      .filter((i) => i.billingReason === 'renewal' && i.status === 'paid')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const known = new Set(
      (
        await this.prisma.payment.findMany({
          where: { lsInvoiceId: { in: invoices.map((i) => i.id) } },
          select: { lsInvoiceId: true },
        })
      ).map((p) => p.lsInvoiceId),
    );

    // A plan change made in LS's customer portal moves the subscription to
    // another variant; renewals are credited at whatever it is now.
    const variantItem = await this.resolveVariant(lsSub.variantId);
    const plan = variantItem?.kind === 'plan' ? variantItem.plan : sub.plan;

    const granted: GrantedPurchase[] = [];
    for (const invoice of invoices) {
      if (known.has(invoice.id)) continue;
      try {
        granted.push(await this.grantRenewal(sub, plan, lsSub, invoice));
      } catch (error) {
        if (isUniqueViolation(error)) continue; // a concurrent sync won
        throw error;
      }
    }

    await this.applyLsStatus(sub.id, lsSub);
    return granted;
  }

  private async grantRenewal(
    sub: Subscription,
    plan: Plan,
    lsSub: LsSubscription,
    invoice: LsInvoice,
  ): Promise<GrantedPurchase> {
    const periodStart = invoice.createdAt;
    const periodEnd = this.periodEndFor(plan.cycle, periodStart, lsSub);
    const description = `${TIER_DISPLAY_NAME[plan.tier]} ${plan.cycle} renewal — ${plan.creditsGranted} credits`;

    const balance = await this.prisma.transaction(async (tx) => {
      await tx.payment.create({
        data: {
          userId: sub.userId,
          subscriptionId: sub.id,
          amountCents: invoice.totalUsd || plan.priceCents,
          currency: 'usd',
          status: 'SUCCEEDED',
          description,
          lsInvoiceId: invoice.id,
        },
      });
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          planId: plan.id,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          lastGrantAt: new Date(),
          grantsIssued: 1,
        },
      });
      return this.applyCredits(
        tx,
        sub.userId,
        plan.creditsGranted,
        CreditReason.SUBSCRIPTION_GRANT,
        sub.id,
        `${plan.tier} ${plan.cycle} renewal (LS invoice ${invoice.id})`,
      );
    }, `grantRenewal(${invoice.id})`);
    this.emailReceipt(sub.userId, {
      description,
      creditsGranted: plan.creditsGranted,
      balance,
      amountCents: invoice.totalUsd || plan.priceCents,
      reference: `LS invoice ${invoice.id}`,
      receiptUrl: invoice.invoiceUrl,
    });

    this.logger.log(
      `Renewal: granted ${plan.creditsGranted} credits to user ${sub.userId} ` +
        `(${plan.tier} ${plan.cycle}, LS invoice ${invoice.id})`,
    );
    return { orderId: invoice.id, description, creditsGranted: plan.creditsGranted };
  }

  /** Mirror what LS says about a subscription that this side cannot otherwise learn. */
  private async applyLsStatus(subscriptionId: string, lsSub: LsSubscription) {
    const current = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!current || current.status === SubscriptionStatus.CANCELED) return;

    const data: Prisma.SubscriptionUpdateInput = {};
    if (lsSub.cancelled && !current.cancelAtPeriodEnd) {
      data.cancelAtPeriodEnd = true;
    }
    if (lsSub.status === 'expired' && current.status !== SubscriptionStatus.EXPIRED) {
      data.status = SubscriptionStatus.EXPIRED;
    } else if (
      (lsSub.status === 'past_due' || lsSub.status === 'unpaid') &&
      current.status === SubscriptionStatus.ACTIVE
    ) {
      data.status = SubscriptionStatus.PAST_DUE;
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.subscription.update({
        where: { id: subscriptionId },
        data,
      });
    }
  }

  /**
   * Whether a subscription's paid period is over.
   *
   * One rule for the expiry cron and for reads, so the UI and the database
   * never disagree. A plan still billing at LS gets LS_RENEWAL_GRACE_MS past
   * its period for the renewal to land; one that will not renew ends on time.
   */
  isLapsed(
    sub: Pick<Subscription, 'currentPeriodEnd' | 'lsSubscriptionId' | 'cancelAtPeriodEnd'>,
    now: Date = new Date(),
  ): boolean {
    const grace =
      sub.lsSubscriptionId && !sub.cancelAtPeriodEnd ? LS_RENEWAL_GRACE_MS : 0;
    return sub.currentPeriodEnd.getTime() + grace <= now.getTime();
  }

  /** The cached balance alone. */
  private async getCreditSummary(userId: number): Promise<{ credits: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    return { credits: user.credits };
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
    return this.prisma.transaction(
      (t) => this.applyCredits(t, userId, amount, reason, refId, note),
      `grantCredits(${reason})`,
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
    if (amount <= 0)
      throw new BadRequestException('Spend amount must be positive.');
    return this.prisma.transaction(async (tx) => {
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
    }, `spendCredits(${jobId})`);
  }

  // ── The credit gate ─────────────────────────────────────────────────────
  //
  // Read-only, charges nothing. Answers three things at once: whether any
  // dubbing can be paid for, how much of the clip the balance actually covers,
  // and what that portion costs.
  //
  // The important departure from the old gate is that a short balance is no
  // longer a flat refusal. Cost is per second, so a wallet that cannot pay for
  // a five-minute video can still pay for the first minute of it — and that is
  // what a new account's one free minute is: not a special case, just a small
  // balance. The caller trims to `billableSeconds` and charges for that.
  async canDub(userId: number, dto: CanDubDto): Promise<CanDubResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    // Plan first: a dub the plan does not include is refused whatever the
    // balance, so the user is told to upgrade rather than to buy credits.
    const tier = await this.assertPlanAllows(userId, dto);

    const duration = Math.max(0, Number(dto.durationSeconds) || 0);
    const cost = costForDub(duration, dto.quality);
    const affordable = affordableSeconds(user.credits, dto.quality);
    const billableSeconds = Math.min(duration, affordable);
    const billableCost = costForDub(billableSeconds, dto.quality);

    return {
      // Not "can you afford the whole thing" but "is there anything to dub".
      // A balance of zero buys zero seconds and is the only refusal.
      allowed: billableSeconds > 0,
      reason: billableSeconds > 0 ? null : 'INSUFFICIENT_CREDITS',
      cost,
      balance: user.credits,
      durationSeconds: duration,
      billableSeconds,
      billableCost,
      // A refusal is not a trim. Without the first clause a wallet that buys
      // nothing reports `trimmed: true` alongside `allowed: false`, which reads
      // as "we cut your video" when in fact nothing is going to be dubbed.
      trimmed: billableSeconds > 0 && billableSeconds < duration,
      affordableSeconds: affordable,
      creditsPerMinute: rateFor(dto.quality),
      tier,
    };
  }

  // Charge the dub. This is where credits actually move. `durationSeconds` is
  // the length ACTUALLY DUBBED — the caller has already trimmed to what the
  // balance covers — so this charges for exactly that and refuses if the
  // balance no longer stretches to it.
  //
  // Idempotent on jobId: a retried request returns the first result and never
  // charges twice.
  async commitDub(userId: number, dto: CommitDubDto): Promise<CommitDubResult> {
    await this.assertPlanAllows(userId, dto);
    const duration = Math.max(0, Number(dto.durationSeconds) || 0);
    const cost = costForDub(duration, dto.quality);

    // Retried on a transient database failure, which is safe precisely because
    // of the idempotency check below: a retry finds its own ledger row and
    // returns the first result rather than charging twice.
    return this.prisma.transaction(async (tx) => {
      // Idempotency: a ledger row already tagged with this jobId means we've
      // committed it before.
      const existing = await tx.creditEntry.findFirst({
        where: { userId, refId: dto.jobId, reason: CreditReason.DUB_SPEND },
      });
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { credits: true },
      });
      if (!user) throw new NotFoundException('User not found.');

      if (existing) {
        return {
          jobId: dto.jobId,
          charged: existing.delta < 0,
          durationSeconds: duration,
          cost: Math.abs(existing.delta),
          balance: user.credits,
          idempotent: true,
        };
      }

      // A zero-length dub costs nothing and has nothing to charge. Still write
      // the marker row, so a retry is recognised as already-committed rather
      // than charged on the second attempt.
      if (cost === 0) {
        await tx.creditEntry.create({
          data: {
            userId,
            delta: 0,
            balance: user.credits,
            reason: CreditReason.DUB_SPEND,
            refId: dto.jobId,
            note: `dub ${dto.jobId} (0s)`,
          },
        });
        return {
          jobId: dto.jobId,
          charged: false,
          durationSeconds: duration,
          cost: 0,
          balance: user.credits,
          idempotent: false,
        };
      }

      // Atomic guarded decrement: two concurrent commits can never both pass
      // the balance check, and the balance never goes negative.
      const decremented = await tx.user.updateMany({
        where: { id: userId, credits: { gte: cost } },
        data: { credits: { decrement: cost } },
      });
      if (decremented.count === 0) {
        // 402, not 400. The request was well-formed; the wallet is empty. A
        // 400 here was indistinguishable from a validation error to every
        // caller — see PaymentRequiredException.
        throw new PaymentRequiredException({
          reason: 'INSUFFICIENT_CREDITS',
          message:
            `Not enough credits — dubbing ${Math.round(duration)}s at ` +
            `${dto.quality} costs ${cost}, you have ${user.credits}.`,
          cost,
          balance: user.credits,
          affordableSeconds: affordableSeconds(user.credits, dto.quality),
        });
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
          note: `dub ${dto.jobId} (${Math.round(duration)}s ${dto.quality})`,
        },
      });
      return {
        jobId: dto.jobId,
        charged: true,
        durationSeconds: duration,
        cost,
        balance: after!.credits,
        idempotent: false,
      };
    }, `commitDub(${dto.jobId})`);
  }

  // ── Plan features ────────────────────────────────────────────────────────
  /**
   * The tier this account is on right now: its latest subscription's tier
   * while that is ACTIVE (or PAST_DUE inside the grace window) and not lapsed,
   * otherwise FREE. Same rule as getSubscription, so the badge the UI shows
   * and the gate the dub hits always agree.
   */
  async getEffectiveTier(userId: number): Promise<PlanTier> {
    const { subscription } = await this.getSubscription(userId);
    if (
      subscription &&
      (subscription.status === SubscriptionStatus.ACTIVE ||
        subscription.status === SubscriptionStatus.PAST_DUE)
    ) {
      return subscription.plan.tier;
    }
    return PlanTier.FREE;
  }

  /** `GET /payments/entitlements` — this account's tier and what it unlocks. */
  async getEntitlements(userId: number) {
    const tier = await this.getEffectiveTier(userId);
    return {
      tier,
      tierName: TIER_DISPLAY_NAME[tier],
      features: PLAN_FEATURES[tier],
      allTiers: PLAN_FEATURES,
      tierNames: TIER_DISPLAY_NAME,
    };
  }

  /** Throws a 402 PLAN_UPGRADE_REQUIRED when the plan does not include this dub. */
  private async assertPlanAllows(
    userId: number,
    dto: CanDubDto,
  ): Promise<PlanTier> {
    const tier = await this.getEffectiveTier(userId);
    const refusal = checkFeatures(tier, dto);
    if (refusal) {
      throw new PlanUpgradeRequiredException({
        message: refusal.message,
        feature: refusal.feature,
        currentTier: tier,
        requiredTier: refusal.requiredTier,
      });
    }
    return tier;
  }

  // ── Subscriptions ────────────────────────────────────────────────────────
  async getSubscription(userId: number) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
    if (!subscription) return { subscription: null };

    // The expiry cron only runs hourly, so a row can still be stamped ACTIVE
    // for a period that has ended. Callers use this to decide which tier to
    // show, so report the effective status rather than the stored one — the
    // cron catches up and writes the same value shortly after.
    const lapsed =
      this.isLapsed(subscription) &&
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
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) {
      throw new NotFoundException('No active subscription to cancel.');
    }

    // Stop the charges at Lemon Squeezy FIRST. Marking the row cancelled here
    // while LS kept billing the card is the one outcome worse than an error:
    // the customer would be charged for a plan they were told had stopped.
    if (subscription.lsSubscriptionId) {
      try {
        await this.ls.cancelSubscription(subscription.lsSubscriptionId);
      } catch (error) {
        this.logger.error(
          `Cancel for user ${userId}: LS subscription ` +
            `${subscription.lsSubscriptionId} could not be cancelled: ` +
            (error instanceof Error ? error.message : String(error)),
        );
        throw new ServiceUnavailableException(
          'We could not reach Lemon Squeezy to stop the renewal, so nothing ' +
            'has changed yet. Please try again in a moment.',
        );
      }
    }

    // The paid period still runs to its end with its unspent credits intact;
    // cancelAtPeriodEnd stops the cron opening another allocation after it.
    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: true },
    });
    return {
      subscription: updated,
      message:
        'Your plan will not renew. Access and unspent credits remain until ' +
        'the period ends.',
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


  // When a monthly plan is bought on Aug 25 it must lapse on Sep 25, not on
  // Sep 24 — so monthly and yearly step by calendar units, not by a fixed
  // 30/365 days. Only the day-of-month is clamped: buying on Jan 31 gives a
  // period ending Feb 28 (or 29), which is how Lemon Squeezy bills too.
  cyclePeriodEnd(cycle: BillingCycle, from: Date = new Date()): Date {
    const end = new Date(from);
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

  // Expose primitives the cron composes with.
  get db(): PrismaService {
    return this.prisma;
  }

  runInTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.transaction(fn, 'runInTransaction');
  }
}

export type { Tx };
