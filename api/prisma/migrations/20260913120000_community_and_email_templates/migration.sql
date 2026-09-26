-- Rename Waitlist -> Community. RENAME, not drop-and-create: the rows are real
-- signups and must survive. Postgres carries the primary key and the unique
-- index across automatically; we rename them too so the names keep matching
-- what Prisma expects.
ALTER TABLE "public"."Waitlist" RENAME TO "Community";
ALTER INDEX "public"."Waitlist_pkey" RENAME TO "Community_pkey";
ALTER INDEX "public"."Waitlist_email_key" RENAME TO "Community_email_key";

-- CreateTable
CREATE TABLE "public"."EmailTemplate" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "heading" TEXT,
    "body" TEXT NOT NULL,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "footnote" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_key_key" ON "public"."EmailTemplate"("key");
