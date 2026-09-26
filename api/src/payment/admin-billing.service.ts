import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreditPack, Plan, PlanTier, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { DodoService } from './dodo.service';
import { parseProductRef } from './dodo-product-ref';
import { CREDITS_PER_MINUTE, QUALITY_MULTIPLIER } from './credit-packs';
import { QUALITY_COST } from './quality-cost';
import {
  CreateCreditPackDto,
  UpdateCreditPackDto,
  UpdatePlanDto,
} from './dto/admin-billing.dto';

// What the admin panel needs to run billing without a deploy.
//
// The whole point of this service is that pasting a Dodo product link into the
// panel is enough to put a plan on sale. So it is deliberately forgiving about
// what "a product link" means (id or URL, either way round) and deliberately
// strict about telling the admin what is still missing — a plan that looks
// saved but cannot be bought is the failure worth designing against.
@Injectable()
export class AdminBillingService {
  private readonly logger = new Logger(AdminBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dodo: DodoService,
  ) {}

  // ── Shared shaping ──────────────────────────────────────────────────────
  private planView(plan: Plan) {
    const sellable = plan.tier !== PlanTier.FREE;
    return {
      ...plan,
      /** Free is never "missing" a product — there is nothing to buy. */
      configured: !sellable || !!(plan.dodoProductId || plan.dodoLinkUrl),
      sellable,
      /** Advertised total for the period: one allocation × allocations. */
      creditsPerPeriod: plan.creditsGranted * plan.grantsPerPeriod,
      /** True when the saved link points at Dodo's test host. */
      linkIsTestMode: this.dodo.isTestCheckoutUrl(plan.dodoLinkUrl),
    };
  }

  private packView(pack: CreditPack) {
    return {
      ...pack,
      configured: !!(pack.dodoProductId || pack.dodoLinkUrl),
      linkIsTestMode: this.dodo.isTestCheckoutUrl(pack.dodoLinkUrl),
    };
  }

  /**
   * Turn whatever the admin pasted into `{ dodoProductId, dodoLinkUrl }`.
   *
   * `undefined` means "field not sent, leave it alone"; an empty string means
   * "clear it", which takes the item off sale without deactivating it. Anything
   * else must parse, or we refuse — saving an unusable value would show as a
   * green "saved" in the panel and a 400 at the customer's checkout.
   */
  private productPatch(
    raw: string | undefined,
  ): { dodoProductId: string | null; dodoLinkUrl: string | null } | undefined {
    if (raw === undefined) return undefined;
    if (raw.trim() === '') return { dodoProductId: null, dodoLinkUrl: null };

    const ref = parseProductRef(raw, this.dodo.environment);
    if (!ref) {
      throw new BadRequestException(
        'Could not read a Dodo product from that value. Paste either the ' +
          'product id (pdt_…) or the full payment link from the dashboard.',
      );
    }
    return { dodoProductId: ref.productId, dodoLinkUrl: ref.linkUrl };
  }

  /**
   * Refuse a product already attached to something else.
   *
   * The unique indexes only cover one table each, so they alone would let the
   * same product sit on a plan AND a credit pack — and a payment for it would
   * then resolve to whichever the webhook looked up first. One product sells
   * exactly one thing, and that has to be checked across both tables.
   */
  private async assertProductFree(
    productId: string | null | undefined,
    self: { planId?: string; packId?: string },
  ): Promise<void> {
    if (!productId) return;

    const [plan, pack] = await Promise.all([
      this.prisma.plan.findUnique({ where: { dodoProductId: productId } }),
      this.prisma.creditPack.findUnique({
        where: { dodoProductId: productId },
      }),
    ]);

    const clash =
      (plan && plan.id !== self.planId && `plan ${plan.tier}/${plan.cycle}`) ||
      (pack && pack.id !== self.packId && `credit pack ${pack.slug}`);

    if (clash) {
      throw new ConflictException(
        `Dodo product ${productId} is already attached to ${clash}. One ` +
          'product sells exactly one thing, or a payment cannot be resolved ' +
          'back to what was bought.',
      );
    }
  }

  /** Backstop for the same clash racing past assertProductFree. */
  private rethrowDuplicateProduct(
    err: unknown,
    productId?: string | null,
  ): never {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new ConflictException(
        `Dodo product ${productId ?? ''} is already attached to another plan or ` +
          'credit pack. One product sells exactly one thing, or a payment ' +
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
    const unconfiguredPlans = sellablePlans.filter(
      (p) => !p.dodoProductId && !p.dodoLinkUrl,
    );
    const activePacks = packs.filter((p) => p.active);
    const unconfiguredPacks = activePacks.filter(
      (p) => !p.dodoProductId && !p.dodoLinkUrl,
    );

    // A live-mode API pointed at test links (or the reverse) takes payments
    // that will never settle where the admin expects. Worth its own flag.
    const liveLinks = [...plans, ...packs].filter(
      (r) => r.dodoLinkUrl && !this.dodo.isTestCheckoutUrl(r.dodoLinkUrl),
    ).length;
    const testLinks = [...plans, ...packs].filter((r) =>
      this.dodo.isTestCheckoutUrl(r.dodoLinkUrl),
    ).length;

    return {
      provider: 'dodo' as const,
      mode:
        this.dodo.environment === 'live_mode'
          ? ('live' as const)
          : ('test' as const),
      /** Hosted checkout sessions. False means static links only. */
      apiConfigured: this.dodo.enabled,
      /** THE critical one: false and no purchase can ever grant credits. */
      webhookConfigured: this.dodo.webhookConfigured,
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
      links: {
        live: liveLinks,
        test: testLinks,
        /** Links from both modes, or links that disagree with the API mode. */
        mixed:
          (liveLinks > 0 && testLinks > 0) ||
          (this.dodo.environment === 'live_mode' && testLinks > 0) ||
          (this.dodo.environment === 'test_mode' && liveLinks > 0),
      },
      /** Credits a dub costs, per quality. Enforced by can-dub / commit-dub. */
      qualityCost: QUALITY_COST,
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

    const product = this.productPatch(dto.dodoProduct);
    if (product && plan.tier === PlanTier.FREE && product.dodoProductId) {
      throw new BadRequestException(
        'The FREE tier cannot be sold, so it takes no Dodo product.',
      );
    }
    await this.assertProductFree(product?.dodoProductId, { planId: plan.id });

    try {
      const updated = await this.prisma.plan.update({
        where: { id },
        data: {
          ...(product ?? {}),
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
          (product ? ` (product → ${product.dodoProductId ?? 'cleared'})` : ''),
      );
      return { plan: this.planView(updated) };
    } catch (err) {
      this.rethrowDuplicateProduct(err, product?.dodoProductId);
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
    const product = this.productPatch(dto.dodoProduct);
    await this.assertProductFree(product?.dodoProductId, {});

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
          ...(product ?? {}),
        },
      });
      this.logger.log(
        `Credit pack ${pack.slug} created (${pack.credits} credits)`,
      );
      return { pack: this.packView(pack) };
    } catch (err) {
      this.rethrowDuplicateProduct(err, product?.dodoProductId);
    }
  }

  async updateCreditPack(id: string, dto: UpdateCreditPackDto) {
    const pack = await this.prisma.creditPack.findUnique({ where: { id } });
    if (!pack) throw new NotFoundException('Credit pack not found.');

    const product = this.productPatch(dto.dodoProduct);
    await this.assertProductFree(product?.dodoProductId, { packId: pack.id });

    try {
      const updated = await this.prisma.creditPack.update({
        where: { id },
        data: {
          ...(product ?? {}),
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
      this.logger.log(`Credit pack ${updated.slug} updated`);
      return { pack: this.packView(updated) };
    } catch (err) {
      this.rethrowDuplicateProduct(err, product?.dodoProductId);
    }
  }

  // Hard delete, SUPERADMIN only. Deactivating is almost always what is
  // wanted: a deleted slug can no longer be resolved by a webhook, so a
  // payment still in flight when it goes would arrive with nothing to grant.
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
