-- Move the one-time credit-pack catalog out of code and into the database, so
-- ADMIN/SUPERADMIN can manage packs (and paste Dodo product links) from the
-- admin panel instead of needing an env change and a redeploy.

CREATE TABLE "public"."CreditPack" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "popular" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "dodoProductId" TEXT,
    "dodoLinkUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditPack_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditPack_slug_key" ON "public"."CreditPack"("slug");
CREATE UNIQUE INDEX "CreditPack_dodoProductId_key" ON "public"."CreditPack"("dodoProductId");
CREATE INDEX "CreditPack_active_sortOrder_idx" ON "public"."CreditPack"("active", "sortOrder");
