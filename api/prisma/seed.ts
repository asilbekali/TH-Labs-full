import { PrismaClient, Role, PlanTier, BillingCycle } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ── Plan catalog (source of truth: step-05 §2 matrix) ──────────────────────
// FREE has no real billing cycle; we store it as MONTHLY so [tier, cycle] stays
// unique and the free 60-credit allocation drips every 30 days like the others.
//
// `creditsGranted` is ONE allocation, not the advertised total. Yearly bills
// once and then drips a month's worth every 30 days, twelve times — so the
// number on the pricing page is `creditsGranted * grantsPerPeriod`:
//
//   Weekly  PRO       300 × 1  =    300      Weekly  STUDIO  1 200 × 1  =  1 200
//   Monthly PRO     1 200 × 1  =  1 200      Monthly STUDIO  4 800 × 1  =  4 800
//   Yearly  PRO     1 200 × 12 = 14 400      Yearly  STUDIO  4 800 × 12 = 57 600
//
// `priceCents` must match the Stripe Payment Link amount exactly — the webhook
// falls back to resolving a plan by `amount_total` when it has no price id.
type PlanSeed = {
  tier: PlanTier;
  cycle: BillingCycle;
  priceCents: number;
  creditsGranted: number;
  grantDays: number;
  grantsPerPeriod: number;
  linkEnv?: string; // env var holding the Stripe Payment Link
};

const PLAN_SEED: PlanSeed[] = [
  { tier: 'FREE', cycle: 'MONTHLY', priceCents: 0, creditsGranted: 60, grantDays: 30, grantsPerPeriod: 1 },

  { tier: 'PRO', cycle: 'WEEKLY', priceCents: 600, creditsGranted: 300, grantDays: 7, grantsPerPeriod: 1, linkEnv: 'STRIPE_LINK_PRO_WEEKLY' },
  { tier: 'PRO', cycle: 'MONTHLY', priceCents: 1900, creditsGranted: 1200, grantDays: 30, grantsPerPeriod: 1, linkEnv: 'STRIPE_LINK_PRO_MONTHLY' },
  { tier: 'PRO', cycle: 'YEARLY', priceCents: 19900, creditsGranted: 1200, grantDays: 30, grantsPerPeriod: 12, linkEnv: 'STRIPE_LINK_PRO_YEARLY' },

  { tier: 'STUDIO', cycle: 'WEEKLY', priceCents: 1500, creditsGranted: 1200, grantDays: 7, grantsPerPeriod: 1, linkEnv: 'STRIPE_LINK_STUDIO_WEEKLY' },
  { tier: 'STUDIO', cycle: 'MONTHLY', priceCents: 4900, creditsGranted: 4800, grantDays: 30, grantsPerPeriod: 1, linkEnv: 'STRIPE_LINK_STUDIO_MONTHLY' },
  { tier: 'STUDIO', cycle: 'YEARLY', priceCents: 49900, creditsGranted: 4800, grantDays: 30, grantsPerPeriod: 12, linkEnv: 'STRIPE_LINK_STUDIO_YEARLY' },
];

async function seedPlans() {
  const missingLinks: string[] = [];

  for (const p of PLAN_SEED) {
    const stripeLinkUrl = p.linkEnv ? process.env[p.linkEnv]?.trim() || null : null;
    if (p.linkEnv && !stripeLinkUrl) missingLinks.push(p.linkEnv);

    await prisma.plan.upsert({
      where: { tier_cycle: { tier: p.tier, cycle: p.cycle } },
      update: {
        priceCents: p.priceCents,
        creditsGranted: p.creditsGranted,
        grantDays: p.grantDays,
        grantsPerPeriod: p.grantsPerPeriod,
        // An unset env var must not wipe a link that is already in the database
        // — seeding is re-run on every deploy and a null here silently breaks
        // checkout for that plan.
        ...(stripeLinkUrl ? { stripeLinkUrl } : {}),
        active: true,
      },
      create: {
        tier: p.tier,
        cycle: p.cycle,
        priceCents: p.priceCents,
        creditsGranted: p.creditsGranted,
        grantDays: p.grantDays,
        grantsPerPeriod: p.grantsPerPeriod,
        stripeLinkUrl,
        active: true,
      },
    });
  }
  console.log(`Seeded ${PLAN_SEED.length} plan rows`);
  if (missingLinks.length > 0) {
    console.warn(
      `WARNING: no Stripe Payment Link for ${missingLinks.join(', ')} — ` +
        'GET /v1/payments/checkout will 400 for those plans.',
    );
  }
}

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@thlabs.dev';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Admin123!';
  const hashedPassword = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      password: hashedPassword,
      role: Role.SUPERADMIN,
    },
    create: {
      email,
      name: 'Super Admin',
      password: hashedPassword,
      role: Role.SUPERADMIN,
    },
  });

  console.log(`Seeded admin account: ${admin.email}`);
}

async function main() {
  await seedAdmin();
  await seedPlans();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
