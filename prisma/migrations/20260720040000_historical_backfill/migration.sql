-- SQLite migration for Phase 3.2 bounded low-priority historical backfill
-- (#1101).
--
-- Adds ONE durable table, BackfillRun, that records an administrator-approved
-- bounded historical backfill: the actor, reason, REQUESTED vs EFFECTIVE
-- (clamped) bounds, progress counters, failures, cancellation, and a resumable
-- checkpoint (`checkpointCursor` = last processed candidate id) so a large run
-- can pause, resume, cancel, and survive a worker restart WITHOUT duplicate
-- jobs and WITHOUT ever widening the approved range.
--
-- BackfillRunStatus is a plain TEXT column under SQLite, so the enum needs NO
-- type creation here — it is enforced by the Prisma client + the PostgreSQL enum
-- type. No CrawlCandidateStatus value is added: backfill reactivates ONLY the
-- historical states the pipeline already produces (OBSERVED_BASELINE = status
-- BASELINE; OBSERVED_SHADOW = status DISCOVERED + observedInBaseline=false) plus
-- gap-suggested sources; SKIPPED_OUTSIDE_WINDOW is deferred (no producer exists
-- yet — see the follow-up).
--
-- METADATA ONLY: actorId is a plain string (not an FK), reason is sanitized
-- operator text, bounds are dates + counts, checkpointCursor is an opaque
-- candidate id, and warnings holds sanitized clamp categories. NEVER a raw URL,
-- article text, secret, cookie, or user-private content.

-- CreateTable
CREATE TABLE "BackfillRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerKey" TEXT NOT NULL,
    "discoverySourceId" TEXT,
    "actorId" TEXT,
    "reason" TEXT NOT NULL,
    "requestedWindowStart" DATETIME,
    "requestedWindowEnd" DATETIME,
    "requestedMaxItems" INTEGER NOT NULL,
    "windowStart" DATETIME,
    "windowEnd" DATETIME,
    "maxItems" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "checkpointCursor" TEXT,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "reactivatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "BackfillRun_status_idx" ON "BackfillRun"("status");

-- CreateIndex
CREATE INDEX "BackfillRun_providerKey_status_idx" ON "BackfillRun"("providerKey", "status");

-- CreateIndex
CREATE INDEX "BackfillRun_discoverySourceId_idx" ON "BackfillRun"("discoverySourceId");

-- CreateIndex
CREATE INDEX "BackfillRun_createdAt_idx" ON "BackfillRun"("createdAt");
