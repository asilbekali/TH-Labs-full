import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreditPack, Plan, PlanTier, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { LemonSqueezyService } from './lemonsqueezy.service';
import { PaymentService } from './payment.service';
import { CREDITS_PER_MINUTE, QUALITY_MULTIPLIER } from './credit-packs';
import { CREDITS_PER_MINUTE_BY_QUALITY } from './quality-cost';
import {
  CreateCreditPackDto,
  UpdateCreditPackDto,
  UpdatePlanDto,
} from './dto/admin-billing.dto';

// What the admin panel needs to run billing without a deploy.
//
// The whole workflow is: make the product in the Lemon Squeezy dashboard,
// copy its share link and variant id, paste them here with the credits and the
// price. No deploy — so changing PRO from 1,200 credits to 1,500, or
// repricing a pack, is a PATCH from the panel and takes effect on the next
// request.
//
// This service is therefore deliberately strict about telling the admin what is
// still missing or inconsistent: a row that looks saved but cannot be bought —
// or, worse, can be bought but not credited — is the failure worth designing
// against. A row is sellable only with BOTH a link and a variant id.
@Injectable()
export class AdminBillingService {
  private readonly logger = new Logger(AdminBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ls: LemonSqueezyService,
    private readonly payments: PaymentService,
  ) {}

  // ── Shared shaping ──────────────────────────────────────────────────────
  private planView(plan: Plan) {
    const sellable = plan.tier !== PlanTier.FREE;
    return {
      ...plan,
      /** Free is never "missing" a link — there is nothing to buy. */
      configured: !sellable || (!!plan.checkoutUrl && !!plan.lsVariantId),
      sellable,
      /** Advertised total for the period: one allocation × allocations. */
      creditsPerPeriod: plan.creditsGranted * plan.grantsPerPeriod,
    };
  }

  private packView(pack: CreditPack) {
    return {
      ...pack,
      configured: !!pack.checkoutUrl && !!pack.lsVariantId,
    };
  }

  /**
   * `undefined` → field not sent, leave it alone. `''` → clear it.
   *
   * Clearing a payment link takes the item off sale without deactivating it,
   * which is the usual way to pause something. The DTO has already checked the
   * shape (`https://<store>.lemonsqueezy.com/checkout/buy/…`), so there is nothing to parse here —
   * only the empty-string convention to apply.
   */
  private nullable(raw: string | undefined): string | null | undefined {
    if (raw === undefined) return undefined;
    return raw.trim() === '' ? null : raw.trim();
  }

  /**
   * Warn — in the response, not the log — about a row that is half wired up.
   *
   * A link without a variant id takes money that cannot be matched back to
   * anything, and a variant id without a link cannot be bought. Neither is
   * saved as an error (the admin may be filling them in one at a time), but
   * the item stays off sale until both are there.
   */
  private wiringWarning(row: {
    checkoutUrl: string | null;
    lsVariantId: string | null;
  }) {
    if (row.checkoutUrl && !row.lsVariantId) {
      return (
        'Checkout link saved, but no lsVariantId — this item stays off sale ' +
        'until it has one, because a paid order could not be matched to it.'
      );
    }
    if (!row.checkoutUrl && row.lsVariantId) {
      return 'Variant id saved, but no checkoutUrl — this item cannot be bought yet.';
    }
    return null;
  }

  /**
   * Refuse a Lemon Squeezy variant already attached to something else.
   *
   * The unique indexes only cover one table each, so they alone would let the
   * same variant sit on a plan AND a credit pack — and a payment for it could
   * then resolve to either. One variant sells exactly one thing, and that has
   * to be checked across both tables.
   */
  private async assertVariantFree(
    variantId: string | null | undefined,
    self: { planId?: string; packId?: string },
  ): Promise<void> {
    if (!variantId) return;

    const [plan, pack] = await Promise.all([
      this.prisma.plan.findUnique({ where: { lsVariantId: variantId } }),
      this.prisma.creditPack.findUnique({
        where: { lsVariantId: variantId },
      }),
    ]);

    const clash =
      (plan && plan.id !== self.planId && `plan ${plan.tier}/${plan.cycle}`) ||
      (pack && pack.id !== self.packId && `credit pack ${pack.slug}`);

    if (clash) {
      throw new ConflictException(
        `Lemon Squeezy variant ${variantId} is already attached to ${clash}. One ` +
          'variant sells exactly one thing, or a payment cannot be resolved ' +
          'back to what was bought.',
      );
    }
  }

  /** Backstop for the same clash racing past assertVariantFree. */
  private rethrowDuplicateVariant(
    err: unknown,
    variantId?: string | null,
  ): never {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new ConflictException(
        `Lemon Squeezy variant ${variantId ?? ''} is already attached to another ` +
          'plan or credit pack. One variant sells exactly one thing, or a payment ' +
          'cannot be resolved back to what was bought.',
      );
    }
    throw err;
  }

  // ── Overview ────────────────────────────────────────────────────────────
  // One call the panel can render a billing health page from, so an admin can
  // see *why* checkout is off without reading server logs.
  async getOverview() {
    const [plans, packs] = await Promise.all([
      this.prisma.plan.findMany({
        orderBy: [{ tier: 'asc' }, { priceCents: 'asc' }],
      }),
      this.prisma.creditPack.findMany({
        orderBy: [{ sortOrder: 'asc' }, { credits: 'asc' }],
      }),
    ]);

    const sellablePlans = plans.filter((p) => p.tier !== PlanTier.FREE);
    const wired = (r: { checkoutUrl: string | null; lsVariantId: string | null }) =>
      !!r.checkoutUrl && !!r.lsVariantId;
    const unconfiguredPlans = sellablePlans.filter((p) => !wired(p));
    const activePacks = packs.filter((p) => p.active);
    const unconfiguredPacks = activePacks.filter((p) => !wired(p));

    return {
      provider: 'lemonsqueezy' as const,
      /**
       * THE critical one: false (no LEMONSQUEEZY_API_KEY) and no purchase can
       * ever grant credits, because there is no way to ask LS whether an order
       * was paid. Buy buttons are disabled rather than taking money that
       * cannot be honoured.
       */
      canGrantCredits: this.ls.configured,
      /**
       * Set this as each LS product's redirect / confirmation button link, so
       * the buyer comes straight back and is credited in seconds. Without it
       * they are still credited, by the cron, within about five minutes.
       */
      successUrl: this.payments.successUrl,
      webhook: {
        required: false,
        note:
          'No webhook is needed. Purchases are found by asking the Lemon ' +
          "Squeezy API for the account's orders: on return to the site, " +
          'every 5 minutes for a day after opening a checkout, and hourly ' +
          'for subscription renewals.',
      },
      plans: {
        total: plans.length,
        sellable: sellablePlans.length,
        unconfigured: unconfiguredPlans.map((p) => `${p.tier}/${p.cycle}`),
      },
      creditPacks: {
        total: packs.length,
        active: activePacks.length,
        unconfigured: unconfiguredPacks.map((p) => p.slug),
      },
      /** Credits a MINUTE of dubbing costs, per quality. Enforced by can-dub. */
      qualityCost: CREDITS_PER_MINUTE_BY_QUALITY,
      /** What the pricing-page estimator quotes with. */
      tariff: {
        creditsPerMinute: CREDITS_PER_MINUTE,
        qualityMultiplier: QUALITY_MULTIPLIER,
      },
    };
  }

  // ── Plans ───────────────────────────────────────────────────────────────
  async listPlans() {
    const plans = await this.prisma.plan.findMany({
      orderBy: [{ tier: 'asc' }, { priceCents: 'asc' }],
    });
    return { plans: plans.map((p) => this.planView(p)) };
  }

  async updatePlan(id: string, dto: UpdatePlanDto) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found.');

    const link = this.nullable(dto.checkoutUrl);
    const variantId = this.nullable(dto.lsVariantId);
    if (plan.tier === PlanTier.FREE && (link || variantId)) {
      throw new BadRequestException(
        'The FREE tier cannot be sold, so it takes no checkout link or variant.',
      );
    }
    await this.assertVariantFree(variantId, { planId: plan.id });

    try {
      const updated = await this.prisma.plan.update({
        where: { id },
        data: {
          ...(link !== undefined ? { checkoutUrl: link } : {}),
          ...(variantId !== undefined ? { lsVariantId: variantId } : {}),
          ...(dto.priceCents !== undefined
            ? { priceCents: dto.priceCents }
            : {}),
          ...(dto.creditsGranted !== undefined
            ? { creditsGranted: dto.creditsGranted }
            : {}),
          ...(dto.grantDays !== undefined ? { grantDays: dto.grantDays } : {}),
          ...(dto.grantsPerPeriod !== undefined
            ? { grantsPerPeriod: dto.grantsPerPeriod }
            : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });

      this.logger.log(
        `Plan ${updated.tier}/${updated.cycle} updated` +
          (link !== undefined
            ? ` (checkout link → ${link ? 'set' : 'cleared'})`
            : '') +
          (dto.creditsGranted !== undefined
            ? ` (credits → ${dto.creditsGranted})`
            : ''),
      );
      return {
        plan: this.planView(updated),
        warning: this.wiringWarning(updated),
      };
    } catch (err) {
      this.rethrowDuplicateVariant(err, variantId);
    }
  }

  // ── Credit packs ────────────────────────────────────────────────────────
  async listCreditPacks() {
    const packs = await this.prisma.creditPack.findMany({
      orderBy: [{ sortOrder: 'asc' }, { credits: 'asc' }],
    });
    return { packs: packs.map((p) => this.packView(p)) };
  }

  async createCreditPack(dto: CreateCreditPackDto) {
    const link = this.nullable(dto.checkoutUrl);
    const variantId = this.nullable(dto.lsVariantId);
    await this.assertVariantFree(variantId, {});

    const existing = await this.prisma.creditPack.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException(
        `A credit pack with slug '${dto.slug}' already exists. Slugs are ` +
          'permanent because checkouts carry them, so pick another.',
      );
    }

    try {
      const pack = await this.prisma.creditPack.create({
        data: {
          slug: dto.slug,
          credits: dto.credits,
          priceCents: dto.priceCents,
          currency: (dto.currency ?? 'usd').toLowerCase(),
          popular: dto.popular ?? false,
          sortOrder: dto.sortOrder ?? 0,
          active: dto.active ?? true,
          ...(link !== undefined ? { checkoutUrl: link } : {}),
          ...(variantId !== undefined ? { lsVariantId: variantId } : {}),
        },
      });
      this.logger.log(
        `Credit pack ${pack.slug} created (${pack.credits} credits)`,
      );
      return { pack: this.packView(pack), warning: this.wiringWarning(pack) };
    } catch (err) {
      this.rethrowDuplicateVariant(err, variantId);
    }
  }

  async updateCreditPack(id: string, dto: UpdateCreditPackDto) {
    const pack = await this.prisma.creditPack.findUnique({ where: { id } });
    if (!pack) throw new NotFoundException('Credit pack not found.');

    const link = this.nullable(dto.checkoutUrl);
    const variantId = this.nullable(dto.lsVariantId);
    await this.assertVariantFree(variantId, { packId: pack.id });

    try {
      const updated = await this.prisma.creditPack.update({
        where: { id },
        data: {
          ...(link !== undefined ? { checkoutUrl: link } : {}),
          ...(variantId !== undefined ? { lsVariantId: variantId } : {}),
          ...(dto.credits !== undefined ? { credits: dto.credits } : {}),
          ...(dto.priceCents !== undefined
            ? { priceCents: dto.priceCents }
            : {}),
          ...(dto.currency !== undefined
            ? { currency: dto.currency.toLowerCase() }
            : {}),
          ...(dto.popular !== undefined ? { popular: dto.popular } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });
      this.logger.log(
        `Credit pack ${updated.slug} updated` +
          (dto.credits !== undefined ? ` (credits → ${dto.credits})` : ''),
      );
      return {
        pack: this.packView(updated),
        warning: this.wiringWarning(updated),
      };
    } catch (err) {
      this.rethrowDuplicateVariant(err, variantId);
    }
  }

  // Hard delete, SUPERADMIN only. Deactivating is almost always what is
  // wanted: a deleted row takes its variant id with it, so a payment still in
  // flight when it goes would arrive with nothing to match and grant nothing.
  async deleteCreditPack(id: string) {
    const pack = await this.prisma.creditPack.findUnique({ where: { id } });
    if (!pack) throw new NotFoundException('Credit pack not found.');

    await this.prisma.creditPack.delete({ where: { id } });
    this.logger.warn(`Credit pack ${pack.slug} deleted`);
    return {
      deleted: true,
      slug: pack.slug,
      message:
        'Pack deleted. Any checkout already open for it will arrive with no ' +
        'pack to match and will not grant credits.',
    };
  }
}
