-- Dodo Payments out, Stripe Payment Links in — and no webhook at all.
--
-- Nothing here drops data: every Dodo column is RENAMED to its Stripe
-- counterpart rather than dropped and recreated, so existing payment and
-- subscription rows keep pointing at the purchase they came from. The ids in
-- them are Dodo's and will not resolve in the Stripe dashboard; they are
-- history, and losing the row entirely would be worse than holding an id that
-- only makes sense next to a date.
--
-- The one structural change is that `Payment.stripeCheckoutSessionId` becomes
-- UNIQUE. That constraint is the entire idempotency guarantee for granting
-- credits now: the row is written in the same transaction as the grant, so a
-- reloaded success page, a double-clicked button or a replayed session id can
-- only ever pay out once. It was non-unique under Dodo because the webhook
-- deduplicated on the payment id instead.

-- ── User ────────────────────────────────────────────────────────────────────
ALTER TABLE "public"."User" RENAME COLUMN "dodoCustomerId" TO "stripeCustomerId";
ALTER INDEX IF EXISTS "User_dodoCustomerId_key" RENAME TO "User_stripeCustomerId_key";

-- ── Plan ────────────────────────────────────────────────────────────────────
ALTER TABLE "public"."Plan" RENAME COLUMN "dodoProductId" TO "stripeProductId";
ALTER TABLE "public"."Plan" RENAME COLUMN "dodoLinkUrl" TO "stripePaymentLink";
ALTER INDEX IF EXISTS "Plan_dodoProductId_key" RENAME TO "Plan_stripeProductId_key";

-- ── CreditPack ──────────────────────────────────────────────────────────────
ALTER TABLE "public"."CreditPack" RENAME COLUMN "dodoProductId" TO "stripeProductId";
ALTER TABLE "public"."CreditPack" RENAME COLUMN "dodoLinkUrl" TO "stripePaymentLink";
ALTER INDEX IF EXISTS "CreditPack_dodoProductId_key" RENAME TO "CreditPack_stripeProductId_key";

-- ── Subscription ────────────────────────────────────────────────────────────
ALTER TABLE "public"."Subscription" RENAME COLUMN "dodoSubscriptionId" TO "stripeSubscriptionId";
ALTER INDEX IF EXISTS "Subscription_dodoSubscriptionId_key" RENAME TO "Subscription_stripeSubscriptionId_key";

-- ── Payment ─────────────────────────────────────────────────────────────────
ALTER TABLE "public"."Payment" RENAME COLUMN "dodoPaymentId" TO "stripePaymentIntentId";
ALTER TABLE "public"."Payment" RENAME COLUMN "dodoCheckoutSessionId" TO "stripeCheckoutSessionId";
ALTER TABLE "public"."Payment" RENAME COLUMN "dodoInvoiceId" TO "stripeInvoiceId";
ALTER INDEX IF EXISTS "Payment_dodoPaymentId_key" RENAME TO "Payment_stripePaymentIntentId_key";
ALTER INDEX IF EXISTS "Payment_dodoInvoiceId_key" RENAME TO "Payment_stripeInvoiceId_key";

-- The new idempotency key. Any pre-existing duplicate session ids (Dodo put the
-- same checkout session on both a subscription payment and its invoice) are
-- cleared first, so adding the constraint cannot fail on history.
UPDATE "public"."Payment" p
   SET "stripeCheckoutSessionId" = NULL
 WHERE "stripeCheckoutSessionId" IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM "public"."Payment" q
      WHERE q."stripeCheckoutSessionId" = p."stripeCheckoutSessionId"
        AND q."id" <> p."id"
   );

CREATE UNIQUE INDEX "Payment_stripeCheckoutSessionId_key"
    ON "public"."Payment"("stripeCheckoutSessionId");

-- ── Stripe product ids are not Dodo product ids ─────────────────────────────
-- Every `pdt_…` left in these columns would be matched against a Stripe
-- `prod_…` and can only ever miss, while still occupying the UNIQUE index. The
-- payment LINKS are cleared for the same reason: a Dodo checkout URL on a Buy
-- button sends the customer to the wrong processor. Both are re-entered from the
-- admin panel once the Stripe products exist, which is the intended workflow.
UPDATE "public"."Plan"       SET "stripeProductId" = NULL, "stripePaymentLink" = NULL;
UPDATE "public"."CreditPack" SET "stripeProductId" = NULL, "stripePaymentLink" = NULL;

-- ── The webhook dedupe table ────────────────────────────────────────────────
-- There is no webhook endpoint any more, so there is nothing to deduplicate.
DROP TABLE IF EXISTS "public"."WebhookEvent";
