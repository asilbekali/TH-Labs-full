-- Switch the billing provider from Stripe to Dodo Payments.
--
-- Every provider-owned identifier is RENAMED rather than dropped and re-added,
-- so existing rows keep their history instead of silently losing the id that
-- ties them to a real payment. Postgres does not rename a column's indexes
-- along with it, so each unique index is renamed too — otherwise Prisma sees
-- drift on the next `migrate dev` and offers to reset the database.

-- ── User ───────────────────────────────────────────────────────────────────
ALTER TABLE "public"."User" RENAME COLUMN "stripeCustomerId" TO "dodoCustomerId";
ALTER INDEX "public"."User_stripeCustomerId_key" RENAME TO "User_dodoCustomerId_key";

-- ── Plan ───────────────────────────────────────────────────────────────────
-- stripePriceId held a Stripe price id; the Dodo equivalent is the product id,
-- which is what every webhook payload carries.
ALTER TABLE "public"."Plan" RENAME COLUMN "stripePriceId" TO "dodoProductId";
ALTER TABLE "public"."Plan" RENAME COLUMN "stripeLinkUrl" TO "dodoLinkUrl";
ALTER INDEX "public"."Plan_stripePriceId_key" RENAME TO "Plan_dodoProductId_key";

-- The old links point at buy.stripe.com and no longer resolve to anything we
-- can charge on. Clearing them means `GET /payments/checkout` refuses with
-- "no product configured" instead of sending a customer to a dead checkout.
UPDATE "public"."Plan" SET "dodoProductId" = NULL, "dodoLinkUrl" = NULL;

-- ── Subscription ───────────────────────────────────────────────────────────
ALTER TABLE "public"."Subscription" RENAME COLUMN "stripeSubscriptionId" TO "dodoSubscriptionId";
ALTER INDEX "public"."Subscription_stripeSubscriptionId_key" RENAME TO "Subscription_dodoSubscriptionId_key";

-- ── Payment ────────────────────────────────────────────────────────────────
-- Dodo has one payment object where Stripe had a session, a payment intent and
-- an invoice: payment_id is the money, checkout_session_id is where it started
-- (not unique — one session can be retried), invoice_id is the receipt.
ALTER TABLE "public"."Payment" RENAME COLUMN "stripePaymentIntentId" TO "dodoPaymentId";
ALTER TABLE "public"."Payment" RENAME COLUMN "stripeSessionId" TO "dodoCheckoutSessionId";
ALTER TABLE "public"."Payment" RENAME COLUMN "stripeInvoiceId" TO "dodoInvoiceId";
ALTER INDEX "public"."Payment_stripePaymentIntentId_key" RENAME TO "Payment_dodoPaymentId_key";
ALTER INDEX "public"."Payment_stripeInvoiceId_key" RENAME TO "Payment_dodoInvoiceId_key";
DROP INDEX "public"."Payment_stripeSessionId_key";

-- ── WebhookEvent ───────────────────────────────────────────────────────────
-- The idempotency key is now the `webhook-id` header (Standard Webhooks).
ALTER TABLE "public"."WebhookEvent" RENAME COLUMN "stripeEventId" TO "eventId";
ALTER INDEX "public"."WebhookEvent_stripeEventId_key" RENAME TO "WebhookEvent_eventId_key";
