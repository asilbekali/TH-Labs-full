-- Live translation sessions (Realtime page, Gemini Live Translate). Additive
-- only: one new table. Generated with `prisma migrate diff` from the previous
-- schema.

-- CreateTable
CREATE TABLE "public"."RealtimeSession" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "targetLanguage" TEXT NOT NULL,
    "grantedSeconds" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RealtimeSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RealtimeSession_userId_createdAt_idx" ON "public"."RealtimeSession"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."RealtimeSession" ADD CONSTRAINT "RealtimeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

