import { PrismaClient, Role, PlanTier, BillingCycle } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { CREDIT_PACK_SEED } from '../src/payment/credit-packs';

const prisma = new PrismaClient();

// ── Lemon Squeezy checkout links ───────────────────────────────────────────
// The catalog is a TABLE an admin edits from the panel, and the panel wins.
// The links and variant ids below are the starting values, so a fresh database
// can sell the moment it boots. They are written only into an EMPTY column:
// re-seeding never overwrites a link or variant an admin has since set.
//
// These are the store's TEST-MODE products. Going live means creating (or
// copying) the products in live mode — they get new ids — and pasting the new
// link and variant id into the admin panel.
//
// A link and its variant id travel together: a row with a link but no variant
// takes money that cannot be matched back to anything, so the app refuses to
// sell it (PaymentService.isSellable).
const LS = 'https://th-labs.lemonsqueezy.com/checkout/buy';

// api/.env can override any starting link / variant id:
//   LEMONSQUEEZY_LINK_<KEY>=https://…   LEMONSQUEEZY_VARIANT_<KEY>=2203365
// where <KEY> is PRO_MONTHLY, PRO_YEARLY, STUDIO_MONTHLY, STUDIO_YEARLY,
// PACK_100, PACK_500 or PACK_2000. Like the defaults, these only fill an EMPTY
// column — once an admin sets a value in the panel, the panel wins.
function fromEnv(
  key: string,
  fallback: { checkoutUrl?: string; lsVariantId?: string },
): { checkoutUrl?: string; lsVariantId?: string } {
  const link = process.env[`LEMONSQUEEZY_LINK_${key}`]?.trim();
  const variant = process.env[`LEMONSQUEEZY_VARIANT_${key}`]?.trim();
  return {
    checkoutUrl: link || fallback.checkoutUrl,
    lsVariantId: variant || fallback.lsVariantId,
  };
}

// ── Plan catalog (source of truth: step-05 §2 matrix) ──────────────────────
// FREE has no real billing cycle; we store it as MONTHLY so [tier, cycle] stays
// unique and the free 60-credit allocation drips every 30 days like the others.
//
// `creditsGranted` is ONE allocation, not the advertised total. Yearly bills
// once and then drips a month's worth every 30 days, twelve times — so the
// number on the pricing page is `creditsGranted * grantsPerPeriod`:
//
//   Monthly PRO     1 200 × 1  =  1 200      Monthly STUDIO  4 800 × 1  =  4 800
//   Yearly  PRO     1 200 × 12 = 14 400      Yearly  STUDIO  4 800 × 12 = 57 600
//
// `priceCents` is the USD price the pricing page shows. Keep it equal to the
// Lemon Squeezy price: what a purchase grants is decided by the order's
// variant, not its amount, but a large difference is logged on every claim.
type PlanSeed = {
  tier: PlanTier;
  cycle: BillingCycle;
  priceCents: number;
  creditsGranted: number;
  grantDays: number;
  grantsPerPeriod: number;
  checkoutUrl?: string;
  lsVariantId?: string;
};

const PLAN_SEED: PlanSeed[] = [
  // The FREE row is a catalog entry, not a recurring grant: the cron only pays
  // out against real Subscription rows, and a free account has none. Its
  // creditsGranted is therefore exactly the one-time welcome bonus registration
  // hands out (SIGNUP_BONUS_CREDITS = 20 = one minute at Balanced), so the
  // pricing page and the wallet cannot disagree about what "free" means.
  { tier: 'FREE', cycle: 'MONTHLY', priceCents: 0, creditsGranted: 20, grantDays: 30, grantsPerPeriod: 1 },

  { tier: 'PRO', cycle: 'MONTHLY', priceCents: 1950, creditsGranted: 1200, grantDays: 30, grantsPerPeriod: 1, checkoutUrl: `${LS}/343dabe2-695e-493b-a42b-29a64cceb8f7`, lsVariantId: '2203365' },
  { tier: 'PRO', cycle: 'YEARLY', priceCents: 19900, creditsGranted: 1200, grantDays: 30, grantsPerPeriod: 12, checkoutUrl: `${LS}/ecbd10b3-080c-4403-9b4d-3401217b4faf`, lsVariantId: '2203407' },

  { tier: 'STUDIO', cycle: 'MONTHLY', priceCents: 4950, creditsGranted: 4800, grantDays: 30, grantsPerPeriod: 1, checkoutUrl: `${LS}/88b81b29-7d54-42e6-a9dd-a65a1811ed50`, lsVariantId: '2203401' },
  { tier: 'STUDIO', cycle: 'YEARLY', priceCents: 49900, creditsGranted: 4800, grantDays: 30, grantsPerPeriod: 12, checkoutUrl: `${LS}/89da850d-e1ac-4b56-90f5-2c548dcfa301`, lsVariantId: '2203414' },
];

/** Fill a link/variant only where the column is still empty — the panel wins. */
async function fillEmpty(
  table: 'plan' | 'creditPack',
  id: string,
  current: { checkoutUrl: string | null; lsVariantId: string | null },
  seed: { checkoutUrl?: string; lsVariantId?: string },
) {
  const data = {
    ...(!current.checkoutUrl && seed.checkoutUrl ? { checkoutUrl: seed.checkoutUrl } : {}),
    ...(!current.lsVariantId && seed.lsVariantId ? { lsVariantId: seed.lsVariantId } : {}),
  };
  if (Object.keys(data).length === 0) return;
  if (table === 'plan') await prisma.plan.update({ where: { id }, data });
  else await prisma.creditPack.update({ where: { id }, data });
}

async function seedPlans() {
  for (const p of PLAN_SEED) {
    const row = await prisma.plan.upsert({
      where: { tier_cycle: { tier: p.tier, cycle: p.cycle } },
      update: {
        priceCents: p.priceCents,
        creditsGranted: p.creditsGranted,
        grantDays: p.grantDays,
        grantsPerPeriod: p.grantsPerPeriod,
        active: true,
      },
      create: {
        tier: p.tier,
        cycle: p.cycle,
        priceCents: p.priceCents,
        creditsGranted: p.creditsGranted,
        grantDays: p.grantDays,
        grantsPerPeriod: p.grantsPerPeriod,
        active: true,
      },
    });
    await fillEmpty('plan', row.id, row, fromEnv(`${p.tier}_${p.cycle}`, p));
  }
  console.log(`Seeded ${PLAN_SEED.length} plan rows`);

  const unsellable = await prisma.plan.findMany({
    where: {
      tier: { not: 'FREE' },
      OR: [{ checkoutUrl: null }, { lsVariantId: null }],
    },
  });
  if (unsellable.length > 0) {
    console.warn(
      `WARNING: ${unsellable.map((p) => `${p.tier}/${p.cycle}`).join(', ')} ` +
        'lack a Lemon Squeezy link or variant id and cannot be bought. Set ' +
        'both in the admin panel.',
    );
  }
}

// ── Credit packs ───────────────────────────────────────────────────────────
// The catalog is a table an ADMIN edits from the panel, so this only ever
// CREATES the starting rows. An existing pack is left completely alone —
// re-seeding after a deploy must not undo a price someone set this morning.
//
// The one exception is an EMPTY link or variant id, which is filled from the
// seed — that is how the Lemon Squeezy products reach a database that already
// had these packs.
async function seedCreditPacks() {
  let created = 0;

  for (const [i, pack] of CREDIT_PACK_SEED.entries()) {
    const existing = await prisma.creditPack.findUnique({
      where: { slug: pack.slug },
    });
    if (existing) {
      await fillEmpty('creditPack', existing.id, existing, fromEnv(pack.slug.toUpperCase(), pack));
      continue;
    }

    await prisma.creditPack.create({
      data: {
        slug: pack.slug,
        credits: pack.credits,
        priceCents: pack.priceCents,
        currency: pack.currency,
        popular: pack.popular ?? false,
        sortOrder: i,
        active: true,
        checkoutUrl: fromEnv(pack.slug.toUpperCase(), pack).checkoutUrl ?? null,
        lsVariantId: fromEnv(pack.slug.toUpperCase(), pack).lsVariantId ?? null,
      },
    });
    created++;
  }

  const unconfigured = await prisma.creditPack.findMany({
    where: { active: true, OR: [{ checkoutUrl: null }, { lsVariantId: null }] },
  });
  console.log(
    `Credit packs: ${created} created, ${CREDIT_PACK_SEED.length - created} left as-is`,
  );
  if (unconfigured.length > 0) {
    console.warn(
      `WARNING: no Lemon Squeezy link or variant id on ${unconfigured.map((p) => p.slug).join(', ')} — ` +
        'those packs cannot be bought. Set them in the admin panel.',
    );
  }
}

// Seeding must be safe to re-run. It is not only invoked by hand: any change to
// a payment link means re-seeding the Plan rows, and that used to take the
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

// ── Language catalog ───────────────────────────────────────────────────────
// Copied verbatim from backend/app/languages.py, which is where these codes
// were verified against the two models. Order here is the display order the
// pipeline shipped (English and the core targets first), stored as sortOrder so
// the picker keeps it without depending on insertion order.
//
// Do NOT invent entries: `whisper` must be a code Whisper accepts and `nllb` a
// real FLORES-200 code, or the stage fails at runtime with a model error rather
// than a validation one.
const LANGUAGE_SEED: [string, string, string, string, string, string][] = [
  ['en', 'English', 'English', '🇬🇧', 'en', 'eng_Latn'],
  ['uz', 'Uzbek', 'Oʻzbekcha', '🇺🇿', 'uz', 'uzn_Latn'],
  ['ru', 'Russian', 'Русский', '🇷🇺', 'ru', 'rus_Cyrl'],
  ['es', 'Spanish', 'Español', '🇪🇸', 'es', 'spa_Latn'],
  ['fr', 'French', 'Français', '🇫🇷', 'fr', 'fra_Latn'],
  ['de', 'German', 'Deutsch', '🇩🇪', 'de', 'deu_Latn'],
  ['it', 'Italian', 'Italiano', '🇮🇹', 'it', 'ita_Latn'],
  ['pt', 'Portuguese', 'Português', '🇵🇹', 'pt', 'por_Latn'],
  ['nl', 'Dutch', 'Nederlands', '🇳🇱', 'nl', 'nld_Latn'],
  ['pl', 'Polish', 'Polski', '🇵🇱', 'pl', 'pol_Latn'],
  ['tr', 'Turkish', 'Türkçe', '🇹🇷', 'tr', 'tur_Latn'],
  ['ar', 'Arabic', 'العربية', '🇸🇦', 'ar', 'arb_Arab'],
  ['fa', 'Persian', 'فارسی', '🇮🇷', 'fa', 'pes_Arab'],
  ['hi', 'Hindi', 'हिन्दी', '🇮🇳', 'hi', 'hin_Deva'],
  ['bn', 'Bengali', 'বাংলা', '🇧🇩', 'bn', 'ben_Beng'],
  ['ur', 'Urdu', 'اردو', '🇵🇰', 'ur', 'urd_Arab'],
  ['zh', 'Chinese', '中文', '🇨🇳', 'zh', 'zho_Hans'],
  ['ja', 'Japanese', '日本語', '🇯🇵', 'ja', 'jpn_Jpan'],
  ['ko', 'Korean', '한국어', '🇰🇷', 'ko', 'kor_Hang'],
  ['vi', 'Vietnamese', 'Tiếng Việt', '🇻🇳', 'vi', 'vie_Latn'],
  ['id', 'Indonesian', 'Bahasa Indonesia', '🇮🇩', 'id', 'ind_Latn'],
  ['th', 'Thai', 'ไทย', '🇹🇭', 'th', 'tha_Thai'],
  ['uk', 'Ukrainian', 'Українська', '🇺🇦', 'uk', 'ukr_Cyrl'],
  ['kk', 'Kazakh', 'Қазақша', '🇰🇿', 'kk', 'kaz_Cyrl'],
  ['az', 'Azerbaijani', 'Azərbaycan', '🇦🇿', 'az', 'azj_Latn'],
  ['sv', 'Swedish', 'Svenska', '🇸🇪', 'sv', 'swe_Latn'],
  ['cs', 'Czech', 'Čeština', '🇨🇿', 'cs', 'ces_Latn'],
  ['el', 'Greek', 'Ελληνικά', '🇬🇷', 'el', 'ell_Grek'],
  ['he', 'Hebrew', 'עברית', '🇮🇱', 'he', 'heb_Hebr'],
  ['ro', 'Romanian', 'Română', '🇷🇴', 'ro', 'ron_Latn'],
  ['hu', 'Hungarian', 'Magyar', '🇭🇺', 'hu', 'hun_Latn'],
  ['fi', 'Finnish', 'Suomi', '🇫🇮', 'fi', 'fin_Latn'],
];

// Re-runnable like the rest of the seed. An operator who deactivated a language
// by hand keeps that decision: `active` is only set on insert, never on update,
// so re-seeding after a deploy does not resurrect a row someone switched off.
async function seedLanguages() {
  for (const [i, [code, name, native, flag, whisper, nllb]] of LANGUAGE_SEED.entries()) {
    await prisma.language.upsert({
      where: { code },
      update: { name, native, flag, whisper, nllb, sortOrder: i },
      create: { code, name, native, flag, whisper, nllb, sortOrder: i, active: true },
    });
  }
  console.log(`Seeded ${LANGUAGE_SEED.length} language rows`);
}

async function main() {
  await seedAdmin();
  await seedPlans();
  await seedCreditPacks();
  await seedLanguages();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
