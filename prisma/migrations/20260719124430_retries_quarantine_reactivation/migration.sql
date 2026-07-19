-- SQLite migration for Phase 2.3 propagation retries, quarantine & extractor-
-- version reactivation (#1093).
--
-- CrawlCandidateStatus is a plain TEXT column under SQLite, so the new enum value
-- (QUARANTINED) requires NO schema change here — it is enforced only by the
-- Prisma client + PostgreSQL enum type.
--
-- New CrawlCandidate columns are METADATA ONLY (reason codes, counts, timestamps
-- + the ingest/extractor version); no response body, article text, or secret is
-- ever persisted.

-- AlterTable
ALTER TABLE "CrawlCandidate" ADD COLUMN "ingestAttemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CrawlCandidate" ADD COLUMN "nextAttemptAt" DATETIME;
ALTER TABLE "CrawlCandidate" ADD COLUMN "lastFailureReason" TEXT;
ALTER TABLE "CrawlCandidate" ADD COLUMN "firstIngestAttemptAt" DATETIME;
ALTER TABLE "CrawlCandidate" ADD COLUMN "extractorVersion" INTEGER;

-- CreateIndex
CREATE INDEX "CrawlCandidate_status_nextAttemptAt_idx" ON "CrawlCandidate"("status", "nextAttemptAt");
