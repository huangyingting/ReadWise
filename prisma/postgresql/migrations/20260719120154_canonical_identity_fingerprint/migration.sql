-- PostgreSQL migration for Phase 2.2 canonical-identity + prose fingerprint (#1092).

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CrawlCandidateStatus" ADD VALUE 'DUPLICATE_ALIAS';
ALTER TYPE "CrawlCandidateStatus" ADD VALUE 'NEEDS_REVIEW';

-- AlterTable
ALTER TABLE "CrawlCandidate" ADD COLUMN     "bodyFingerprint" TEXT,
ADD COLUMN     "bodyFingerprintVersion" INTEGER;

-- CreateIndex
CREATE INDEX "CrawlCandidate_providerKey_bodyFingerprint_idx" ON "CrawlCandidate"("providerKey", "bodyFingerprint");
