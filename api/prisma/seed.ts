import { PrismaClient, Role, PlanTier, BillingCycle } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ── Plan catalog (source of truth: step-05 §2 matrix) ──────────────────────
// FREE has no real billing cycle; we store it as MONTHLY so [tier, cycle] stays
// unique and the free 60-credit allocation drips every 30 days like the others.
type PlanSeed = {
  tier: PlanTier;
  cycle: BillingCycle;
  priceCents: number;
  creditsGranted: number;
  grantDays: number;
  linkEnv?: string; // env var holding the Stripe Payment Link
};

const PLAN_SEED: PlanSeed[] = [
  { tier: 'FREE', cycle: 'MONTHLY', priceCents: 0, creditsGranted: 60, grantDays: 30 },

  { tier: 'PRO', cycle: 'WEEKLY', priceCents: 600, creditsGranted: 150, grantDays: 7, linkEnv: 'STRIPE_LINK_PRO_WEEKLY' },
  { tier: 'PRO', cycle: 'MONTHLY', priceCents: 1900, creditsGranted: 600, grantDays: 30, linkEnv: 'STRIPE_LINK_PRO_MONTHLY' },
  { tier: 'PRO', cycle: 'YEARLY', priceCents: 18200, creditsGranted: 600, grantDays: 30, linkEnv: 'STRIPE_LINK_PRO_YEARLY' },

  { tier: 'STUDIO', cycle: 'WEEKLY', priceCents: 1500, creditsGranted: 500, grantDays: 7, linkEnv: 'STRIPE_LINK_STUDIO_WEEKLY' },
  { tier: 'STUDIO', cycle: 'MONTHLY', priceCents: 4900, creditsGranted: 2000, grantDays: 30, linkEnv: 'STRIPE_LINK_STUDIO_MONTHLY' },
  { tier: 'STUDIO', cycle: 'YEARLY', priceCents: 47000, creditsGranted: 2000, grantDays: 30, linkEnv: 'STRIPE_LINK_STUDIO_YEARLY' },
];

async function seedPlans() {
  for (const p of PLAN_SEED) {
    const stripeLinkUrl = p.linkEnv ? process.env[p.linkEnv] ?? null : null;
    await prisma.plan.upsert({
      where: { tier_cycle: { tier: p.tier, cycle: p.cycle } },
      update: {
        priceCents: p.priceCents,
        creditsGranted: p.creditsGranted,
        grantDays: p.grantDays,
        stripeLinkUrl,
        active: true,
      },
      create: {
        tier: p.tier,
        cycle: p.cycle,
        priceCents: p.priceCents,
        creditsGranted: p.creditsGranted,
        grantDays: p.grantDays,
        stripeLinkUrl,
        active: true,
      },
    });
  }
  console.log(`Seeded ${PLAN_SEED.length} plan rows`);
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
