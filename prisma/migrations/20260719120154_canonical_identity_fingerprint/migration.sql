-- SQLite migration for Phase 2.2 canonical-identity + prose fingerprint (#1092).
--
-- CrawlCandidateStatus is a plain TEXT column under SQLite, so the two new enum
-- values (DUPLICATE_ALIAS, NEEDS_REVIEW) require NO schema change here — they are
-- enforced only by the Prisma client + PostgreSQL enum type.

-- AlterTable
ALTER TABLE "CrawlCandidate" ADD COLUMN "bodyFingerprint" TEXT;
ALTER TABLE "CrawlCandidate" ADD COLUMN "bodyFingerprintVersion" INTEGER;

-- CreateIndex
CREATE INDEX "CrawlCandidate_providerKey_bodyFingerprint_idx" ON "CrawlCandidate"("providerKey", "bodyFingerprint");
