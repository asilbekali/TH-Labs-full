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

// Seeding must be safe to re-run. It is not only invoked by hand: any change to
// a Payment Link means re-seeding the Plan rows, and that used to take the
// superadmin's password with it -- rewriting it to the literal below, which is
// published in this repository. A deploy step that quietly resets a production
// credential is a trap, so the password is now only ever written when someone
// asked for it.
async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@thlabs.dev';
  const requestedPassword = process.env.SEED_ADMIN_PASSWORD;
  const password = requestedPassword ?? 'Admin123!';
  const hashedPassword = await bcrypt.hash(password, 10);

  const existing = await prisma.user.findUnique({ where: { email } });

  const admin = await prisma.user.upsert({
    where: { email },
    // Only rotate the password when SEED_ADMIN_PASSWORD was explicitly set.
    // Without it, re-seeding leaves the existing account exactly as it is.
    update: {
      role: Role.SUPERADMIN,
      ...(requestedPassword ? { password: hashedPassword } : {}),
    },
    create: {
      email,
      name: 'Super Admin',
      password: hashedPassword,
      role: Role.SUPERADMIN,
    },
  });

  if (existing) {
    console.log(
      requestedPassword
        ? `Admin ${admin.email}: password rotated from SEED_ADMIN_PASSWORD`
        : `Admin ${admin.email}: left unchanged (set SEED_ADMIN_PASSWORD to rotate)`,
    );
  } else if (requestedPassword) {
    console.log(`Created admin account: ${admin.email}`);
  } else {
    // Creating a fresh account with the built-in password is the one case that
    // genuinely warrants shouting: the credential is in the public repo.
    console.warn(
      `WARNING: created ${admin.email} with the DEFAULT password from seed.ts, ` +
        'which is public. Change it now, or re-run with SEED_ADMIN_EMAIL and ' +
        'SEED_ADMIN_PASSWORD set.',
    );
  }
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
