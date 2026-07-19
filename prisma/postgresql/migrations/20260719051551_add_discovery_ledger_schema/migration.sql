-- CreateEnum
CREATE TYPE "DiscoverySourceRole" AS ENUM ('PRIMARY_FEED', 'SECTION_INDEX', 'ARCHIVE_INDEX', 'SITEMAP', 'SUPPLEMENTAL');

-- CreateEnum
CREATE TYPE "DiscoverySourceLifecycleMode" AS ENUM ('DISABLED', 'SHADOW', 'BASELINE', 'ACTIVE', 'PAUSED', 'RETIRED');

-- CreateEnum
CREATE TYPE "DiscoveryAutomationPolicy" AS ENUM ('MANUAL', 'SCHEDULED', 'CONTINUOUS');

-- CreateEnum
CREATE TYPE "DiscoverySourceHealth" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'FAILING', 'BLOCKED');

-- CreateEnum
CREATE TYPE "DiscoveryGapState" AS ENUM ('NONE', 'SUSPECTED', 'DETECTED');

-- CreateEnum
CREATE TYPE "CrawlCandidateStatus" AS ENUM ('DISCOVERED', 'BASELINE', 'QUEUED', 'INGESTING', 'INGESTED', 'SKIPPED', 'REJECTED', 'FAILED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "CandidateDateProvenance" AS ENUM ('UNKNOWN', 'FEED', 'PAGE_METADATA', 'URL', 'HTTP_HEADER', 'INFERRED');

-- CreateEnum
CREATE TYPE "UrlAliasKind" AS ENUM ('PROVISIONAL', 'REDIRECT', 'CANONICAL', 'DUPLICATE', 'MIRROR');

-- CreateEnum
CREATE TYPE "CanonicalConflictStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "DiscoverySource" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "definitionVersion" INTEGER NOT NULL DEFAULT 1,
    "role" "DiscoverySourceRole" NOT NULL DEFAULT 'PRIMARY_FEED',
    "lifecycleMode" "DiscoverySourceLifecycleMode" NOT NULL DEFAULT 'DISABLED',
    "automationPolicy" "DiscoveryAutomationPolicy" NOT NULL DEFAULT 'MANUAL',
    "health" "DiscoverySourceHealth" NOT NULL DEFAULT 'UNKNOWN',
    "scheduleCron" TEXT,
    "pollIntervalSeconds" INTEGER,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "leaseAcquiredAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "checkpointCursor" TEXT,
    "checkpointPage" INTEGER,
    "watermarkAt" TIMESTAMP(3),
    "watermarkKey" TEXT,
    "validatorVersion" TEXT,
    "baselineStartedAt" TIMESTAMP(3),
    "baselineCompletedAt" TIMESTAMP(3),
    "baselineObservedCount" INTEGER NOT NULL DEFAULT 0,
    "activatedAt" TIMESTAMP(3),
    "backoffUntil" TIMESTAMP(3),
    "backoffLevel" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "discoveryBudgetPerRun" INTEGER,
    "bodyFetchBudgetPerRun" INTEGER,
    "backfillBudgetPerRun" INTEGER,
    "gapState" "DiscoveryGapState" NOT NULL DEFAULT 'NONE',
    "gapDetectedAt" TIMESTAMP(3),
    "gapNote" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoverySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlCandidate" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "discoverySourceId" TEXT,
    "identityVersion" INTEGER NOT NULL DEFAULT 1,
    "provisionalKey" TEXT NOT NULL,
    "canonicalKey" TEXT,
    "status" "CrawlCandidateStatus" NOT NULL DEFAULT 'DISCOVERED',
    "observedInBaseline" BOOLEAN NOT NULL DEFAULT false,
    "firstObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observationCount" INTEGER NOT NULL DEFAULT 0,
    "processingVersion" TEXT,
    "trustedPublishedAt" TIMESTAMP(3),
    "dateProvenance" "CandidateDateProvenance" NOT NULL DEFAULT 'UNKNOWN',
    "terminalReason" TEXT,
    "terminalAt" TIMESTAMP(3),
    "ingestedAt" TIMESTAMP(3),
    "articleDeletedAt" TIMESTAMP(3),
    "articleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrawlCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UrlAlias" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "identityVersion" INTEGER NOT NULL DEFAULT 1,
    "aliasKey" TEXT NOT NULL,
    "kind" "UrlAliasKind" NOT NULL DEFAULT 'PROVISIONAL',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UrlAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryObservation" (
    "id" TEXT NOT NULL,
    "discoverySourceId" TEXT NOT NULL,
    "candidateId" TEXT,
    "runId" TEXT,
    "identityVersion" INTEGER NOT NULL DEFAULT 1,
    "observationKey" TEXT NOT NULL,
    "observedCanonicalKey" TEXT,
    "positionRank" INTEGER,
    "httpStatus" INTEGER,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalConflict" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "identityVersion" INTEGER NOT NULL DEFAULT 1,
    "canonicalKey" TEXT NOT NULL,
    "challengerKey" TEXT NOT NULL,
    "incumbentCandidateId" TEXT,
    "status" "CanonicalConflictStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalConflict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoverySource_providerKey_idx" ON "DiscoverySource"("providerKey");

-- CreateIndex
CREATE INDEX "DiscoverySource_lifecycleMode_idx" ON "DiscoverySource"("lifecycleMode");

-- CreateIndex
CREATE INDEX "DiscoverySource_health_idx" ON "DiscoverySource"("health");

-- CreateIndex
CREATE INDEX "DiscoverySource_automationPolicy_idx" ON "DiscoverySource"("automationPolicy");

-- CreateIndex
CREATE INDEX "DiscoverySource_nextRunAt_idx" ON "DiscoverySource"("nextRunAt");

-- CreateIndex
CREATE INDEX "DiscoverySource_leaseExpiresAt_idx" ON "DiscoverySource"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "DiscoverySource_gapState_idx" ON "DiscoverySource"("gapState");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoverySource_providerKey_sourceKey_definitionVersion_key" ON "DiscoverySource"("providerKey", "sourceKey", "definitionVersion");

-- CreateIndex
CREATE INDEX "CrawlCandidate_providerKey_idx" ON "CrawlCandidate"("providerKey");

-- CreateIndex
CREATE INDEX "CrawlCandidate_discoverySourceId_idx" ON "CrawlCandidate"("discoverySourceId");

-- CreateIndex
CREATE INDEX "CrawlCandidate_status_idx" ON "CrawlCandidate"("status");

-- CreateIndex
CREATE INDEX "CrawlCandidate_articleId_idx" ON "CrawlCandidate"("articleId");

-- CreateIndex
CREATE INDEX "CrawlCandidate_observedInBaseline_idx" ON "CrawlCandidate"("observedInBaseline");

-- CreateIndex
CREATE INDEX "CrawlCandidate_providerKey_status_idx" ON "CrawlCandidate"("providerKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlCandidate_providerKey_identityVersion_provisionalKey_key" ON "CrawlCandidate"("providerKey", "identityVersion", "provisionalKey");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlCandidate_providerKey_canonicalKey_key" ON "CrawlCandidate"("providerKey", "canonicalKey");

-- CreateIndex
CREATE INDEX "UrlAlias_candidateId_idx" ON "UrlAlias"("candidateId");

-- CreateIndex
CREATE INDEX "UrlAlias_providerKey_idx" ON "UrlAlias"("providerKey");

-- CreateIndex
CREATE UNIQUE INDEX "UrlAlias_providerKey_identityVersion_aliasKey_key" ON "UrlAlias"("providerKey", "identityVersion", "aliasKey");

-- CreateIndex
CREATE INDEX "DiscoveryObservation_discoverySourceId_observedAt_idx" ON "DiscoveryObservation"("discoverySourceId", "observedAt");

-- CreateIndex
CREATE INDEX "DiscoveryObservation_candidateId_idx" ON "DiscoveryObservation"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryObservation_discoverySourceId_observationKey_key" ON "DiscoveryObservation"("discoverySourceId", "observationKey");

-- CreateIndex
CREATE INDEX "CanonicalConflict_providerKey_idx" ON "CanonicalConflict"("providerKey");

-- CreateIndex
CREATE INDEX "CanonicalConflict_status_idx" ON "CanonicalConflict"("status");

-- CreateIndex
CREATE INDEX "CanonicalConflict_incumbentCandidateId_idx" ON "CanonicalConflict"("incumbentCandidateId");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalConflict_providerKey_identityVersion_canonicalKey_key" ON "CanonicalConflict"("providerKey", "identityVersion", "canonicalKey");

-- AddForeignKey
ALTER TABLE "CrawlCandidate" ADD CONSTRAINT "CrawlCandidate_discoverySourceId_fkey" FOREIGN KEY ("discoverySourceId") REFERENCES "DiscoverySource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlCandidate" ADD CONSTRAINT "CrawlCandidate_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrlAlias" ADD CONSTRAINT "UrlAlias_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CrawlCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryObservation" ADD CONSTRAINT "DiscoveryObservation_discoverySourceId_fkey" FOREIGN KEY ("discoverySourceId") REFERENCES "DiscoverySource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryObservation" ADD CONSTRAINT "DiscoveryObservation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CrawlCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalConflict" ADD CONSTRAINT "CanonicalConflict_incumbentCandidateId_fkey" FOREIGN KEY ("incumbentCandidateId") REFERENCES "CrawlCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
