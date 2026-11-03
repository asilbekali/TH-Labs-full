-- Studio Max tools: the speech editor (SpeechEdit) and the video editor
-- (EditorProject). Additive only: two new tables and one enum.

-- CreateEnum
CREATE TYPE "public"."SpeechEditStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "public"."SpeechEdit" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "jobId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "public"."SpeechEditStatus" NOT NULL DEFAULT 'QUEUED',
    "segments" JSONB NOT NULL,
    "changed" JSONB NOT NULL,
    "outputPath" TEXT,
    "message" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeechEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EditorProject" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "assets" JSONB NOT NULL DEFAULT '[]',
    "tracks" JSONB NOT NULL DEFAULT '[]',
    "render" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditorProject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpeechEdit_userId_jobId_idx" ON "public"."SpeechEdit"("userId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "SpeechEdit_userId_jobId_version_key" ON "public"."SpeechEdit"("userId", "jobId", "version");

-- CreateIndex
CREATE INDEX "EditorProject_userId_updatedAt_idx" ON "public"."EditorProject"("userId", "updatedAt");

-- AddForeignKey
ALTER TABLE "public"."SpeechEdit" ADD CONSTRAINT "SpeechEdit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EditorProject" ADD CONSTRAINT "EditorProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

