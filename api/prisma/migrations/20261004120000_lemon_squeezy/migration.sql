-- Stripe Payment Links out, Lemon Squeezy share links in. Still no webhook.
--
-- Columns are RENAMED rather than dropped, so nothing that already exists
-- loses its history. At the time of writing there are no Payment or
-- Subscription rows at all — Stripe was never configured — so the ids being
-- carried over are empty in practice.
--
-- What changes in meaning:
--   * Plan / CreditPack are matched to a payment by the LS VARIANT id, which
--     LS reports on the order and the buyer cannot alter.
--   * Payment is deduplicated on the LS order id (first purchase) and on the
--     LS subscription-invoice id (each renewal). Both UNIQUE: the row is
--     written in the same transaction as the credit grant.
--   * User gains lsCheckoutStartedAt, which the cron uses to look for orders
--     from buyers who paid and never came back to the site.

-- ── User ────────────────────────────────────────────────────────────────────
ALTER TABLE "public"."User" RENAME COLUMN "stripeCustomerId" TO "lsCustomerId";
-- Not unique any more: a failed unique update inside the claim transaction
-- would abort the whole grant, and nothing is ever looked up by it.
DROP INDEX IF EXISTS "public"."User_stripeCustomerId_key";
ALTER TABLE "public"."User" ADD COLUMN "lsCheckoutStartedAt" TIMESTAMP(3);

-- ── Plan ────────────────────────────────────────────────────────────────────
ALTER TABLE "public"."Plan" RENAME COLUMN "stripePaymentLink" TO "checkoutUrl";
ALTER TABLE "public"."Plan" RENAME COLUMN "stripeProductId" TO "lsVariantId";
ALTER INDEX IF EXISTS "public"."Plan_stripeProductId_key" RENAME TO "Plan_lsVariantId_key";

-- ── CreditPack ──────────────────────────────────────────────────────────────
ALTER TABLE "public"."CreditPack" RENAME COLUMN "stripePaymentLink" TO "checkoutUrl";
ALTER TABLE "public"."CreditPack" RENAME COLUMN "stripeProductId" TO "lsVariantId";
ALTER INDEX IF EXISTS "public"."CreditPack_stripeProductId_key" RENAME TO "CreditPack_lsVariantId_key";

-- ── Subscription ────────────────────────────────────────────────────────────
ALTER TABLE "public"."Subscription" RENAME COLUMN "stripeSubscriptionId" TO "lsSubscriptionId";
ALTER INDEX IF EXISTS "public"."Subscription_stripeSubscriptionId_key" RENAME TO "Subscription_lsSubscriptionId_key";

-- ── Payment ─────────────────────────────────────────────────────────────────
ALTER TABLE "public"."Payment" RENAME COLUMN "stripeCheckoutSessionId" TO "lsOrderId";
ALTER TABLE "public"."Payment" RENAME COLUMN "stripePaymentIntentId" TO "lsOrderIdentifier";
ALTER TABLE "public"."Payment" RENAME COLUMN "stripeInvoiceId" TO "lsInvoiceId";
ALTER INDEX IF EXISTS "public"."Payment_stripeCheckoutSessionId_key" RENAME TO "Payment_lsOrderId_key";
ALTER INDEX IF EXISTS "public"."Payment_stripePaymentIntentId_key" RENAME TO "Payment_lsOrderIdentifier_key";
ALTER INDEX IF EXISTS "public"."Payment_stripeInvoiceId_key" RENAME TO "Payment_lsInvoiceId_key";

-- ── Stripe ids are not Lemon Squeezy ids ────────────────────────────────────
-- Any Stripe product id or link left behind would be matched against an LS
-- variant and could only miss. The seed (or the admin panel) fills these in.
UPDATE "public"."Plan"       SET "lsVariantId" = NULL, "checkoutUrl" = NULL;
UPDATE "public"."CreditPack" SET "lsVariantId" = NULL, "checkoutUrl" = NULL;
