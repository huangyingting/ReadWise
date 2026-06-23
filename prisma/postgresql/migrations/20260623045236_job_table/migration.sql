-- Durable background-job queue (RW-013/014/015).
-- Mirrors the SQLite "Job" table. `type`/`status` are native PostgreSQL enums
-- (matching the ArticleStatus convention reconciled in privacy_article_model).
-- Multi-worker claiming uses FOR UPDATE SKIP LOCKED at the application layer.

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('ARTICLE_INGEST', 'ARTICLE_PROCESS', 'AI_REBUILD', 'TTS_GENERATE', 'PUSH_REMINDER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'CLAIMED', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "errorHistory" JSONB NOT NULL,
    "dedupeKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "deadLetteredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_status_runAfter_idx" ON "Job"("status", "runAfter");

-- CreateIndex
CREATE INDEX "Job_status_type_runAfter_idx" ON "Job"("status", "type", "runAfter");

-- CreateIndex
CREATE INDEX "Job_type_status_idx" ON "Job"("type", "status");

-- CreateIndex
CREATE INDEX "Job_lockedBy_idx" ON "Job"("lockedBy");

-- CreateIndex
CREATE INDEX "Job_lockedAt_idx" ON "Job"("lockedAt");
