-- PostgreSQL migration for Phase 3.2 bounded low-priority historical backfill
-- (#1101).
--
-- Adds the BackfillRunStatus enum type and ONE durable table, BackfillRun, that
-- records an administrator-approved bounded historical backfill: the actor,
-- reason, REQUESTED vs EFFECTIVE (clamped) bounds, progress counters, failures,
-- cancellation, and a resumable checkpoint (`checkpointCursor` = last processed
-- candidate id) so a large run can pause, resume, cancel, and survive a worker
-- restart WITHOUT duplicate jobs and WITHOUT ever widening the approved range.
--
-- No CrawlCandidateStatus value is added: backfill reactivates ONLY the
-- historical states the pipeline already produces (OBSERVED_BASELINE = status
-- BASELINE; OBSERVED_SHADOW = status DISCOVERED + observedInBaseline=false) plus
-- gap-suggested sources; SKIPPED_OUTSIDE_WINDOW is deferred (no producer exists
-- yet — see the follow-up), so no ALTER TYPE is required here.
--
-- METADATA ONLY: actorId is a plain string (not an FK), reason is sanitized
-- operator text, bounds are dates + counts, checkpointCursor is an opaque
-- candidate id, and warnings holds sanitized clamp categories. NEVER a raw URL,
-- article text, secret, cookie, or user-private content.

-- CreateEnum
CREATE TYPE "BackfillRunStatus" AS ENUM ('RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "BackfillRun" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "discoverySourceId" TEXT,
    "actorId" TEXT,
    "reason" TEXT NOT NULL,
    "requestedWindowStart" TIMESTAMP(3),
    "requestedWindowEnd" TIMESTAMP(3),
    "requestedMaxItems" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "maxItems" INTEGER NOT NULL,
    "status" "BackfillRunStatus" NOT NULL DEFAULT 'RUNNING',
    "checkpointCursor" TEXT,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "reactivatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackfillRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackfillRun_status_idx" ON "BackfillRun"("status");

-- CreateIndex
CREATE INDEX "BackfillRun_providerKey_status_idx" ON "BackfillRun"("providerKey", "status");

-- CreateIndex
CREATE INDEX "BackfillRun_discoverySourceId_idx" ON "BackfillRun"("discoverySourceId");

-- CreateIndex
CREATE INDEX "BackfillRun_createdAt_idx" ON "BackfillRun"("createdAt");
