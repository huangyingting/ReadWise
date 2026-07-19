-- PostgreSQL migration for Phase 2.3 propagation retries, quarantine & extractor-
-- version reactivation (#1093).
--
-- New CrawlCandidate columns are METADATA ONLY (reason codes, counts, timestamps
-- + the ingest/extractor version); no response body, article text, or secret is
-- ever persisted.

-- AlterEnum
ALTER TYPE "CrawlCandidateStatus" ADD VALUE 'QUARANTINED';

-- AlterTable
ALTER TABLE "CrawlCandidate" ADD COLUMN     "ingestAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "lastFailureReason" TEXT,
ADD COLUMN     "firstIngestAttemptAt" TIMESTAMP(3),
ADD COLUMN     "extractorVersion" INTEGER;

-- CreateIndex
CREATE INDEX "CrawlCandidate_status_nextAttemptAt_idx" ON "CrawlCandidate"("status", "nextAttemptAt");
