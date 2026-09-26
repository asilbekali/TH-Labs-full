-- Product feedback left from inside the app (Home → Feedback section).
--
-- Separate from "Community" on purpose: that table is a contact list built from
-- the landing page, this one is an inbox of messages to read and answer.

-- CreateEnum
CREATE TYPE "public"."FeedbackKind" AS ENUM ('GENERAL', 'BUG', 'FEATURE', 'PRICING', 'QUALITY');

-- CreateEnum
CREATE TYPE "public"."FeedbackStatus" AS ENUM ('NEW', 'READ', 'IN_PROGRESS', 'RESOLVED', 'SPAM');

-- CreateTable
CREATE TABLE "public"."Feedback" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "kind" "public"."FeedbackKind" NOT NULL DEFAULT 'GENERAL',
    "rating" INTEGER,
    "status" "public"."FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "adminNote" TEXT,
    "pagePath" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Feedback_status_createdAt_idx" ON "public"."Feedback"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Feedback_kind_createdAt_idx" ON "public"."Feedback"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "Feedback_userId_idx" ON "public"."Feedback"("userId");

-- AddForeignKey
-- ON DELETE SET NULL, not CASCADE: deleting an account must not delete what
-- that person told us. The `name`/`email` snapshot on the row keeps the
-- message attributable afterwards.
ALTER TABLE "public"."Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
