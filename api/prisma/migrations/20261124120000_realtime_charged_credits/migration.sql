-- Real-time sessions paid with credits. Additive only: one new column, and the
-- existing rows are all free sessions.

-- AlterTable
ALTER TABLE "public"."RealtimeSession" ADD COLUMN "chargedCredits" INTEGER NOT NULL DEFAULT 0;
