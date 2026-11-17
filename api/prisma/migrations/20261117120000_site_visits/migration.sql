-- Visitor counting for the admin panel's Agent City. Additive only: one new
-- table, no foreign keys (a visit outlives nothing and blocks no delete).

-- CreateTable
CREATE TABLE "public"."SiteVisit" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "userId" INTEGER,
    "pageviews" INTEGER NOT NULL DEFAULT 1,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteVisit_visitorId_day_site_key" ON "public"."SiteVisit"("visitorId", "day", "site");

-- CreateIndex
CREATE INDEX "SiteVisit_lastSeen_idx" ON "public"."SiteVisit"("lastSeen");
