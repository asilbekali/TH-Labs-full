-- A separate wallet for real-time dubbing tokens. Additive only: every existing
-- balance and ledger row stays in the AI-dubbing wallet (DUB).

-- CreateEnum
CREATE TYPE "public"."CreditWallet" AS ENUM ('DUB', 'REALTIME');

-- AlterEnum
ALTER TYPE "public"."CreditReason" ADD VALUE 'REALTIME_SPEND';

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN "realtimeCredits" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "public"."CreditEntry" ADD COLUMN "wallet" "public"."CreditWallet" NOT NULL DEFAULT 'DUB';
