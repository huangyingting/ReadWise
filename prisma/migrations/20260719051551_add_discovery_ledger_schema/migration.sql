-- CreateTable
CREATE TABLE "DiscoverySource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerKey" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "definitionVersion" INTEGER NOT NULL DEFAULT 1,
    "role" TEXT NOT NULL DEFAULT 'PRIMARY_FEED',
    "lifecycleMode" TEXT NOT NULL DEFAULT 'DISABLED',
    "automationPolicy" TEXT NOT NULL DEFAULT 'MANUAL',
    "health" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "scheduleCron" TEXT,
    "pollIntervalSeconds" INTEGER,
    "nextRunAt" DATETIME,
    "lastRunAt" DATETIME,
    "leaseOwner" TEXT,
    "leaseAcquiredAt" DATETIME,
    "leaseExpiresAt" DATETIME,
    "checkpointCursor" TEXT,
    "checkpointPage" INTEGER,
    "watermarkAt" DATETIME,
    "watermarkKey" TEXT,
    "validatorVersion" TEXT,
    "baselineStartedAt" DATETIME,
    "baselineCompletedAt" DATETIME,
    "baselineObservedCount" INTEGER NOT NULL DEFAULT 0,
    "activatedAt" DATETIME,
    "backoffUntil" DATETIME,
    "backoffLevel" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "discoveryBudgetPerRun" INTEGER,
    "bodyFetchBudgetPerRun" INTEGER,
    "backfillBudgetPerRun" INTEGER,
    "gapState" TEXT NOT NULL DEFAULT 'NONE',
    "gapDetectedAt" DATETIME,
    "gapNote" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CrawlCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerKey" TEXT NOT NULL,
    "discoverySourceId" TEXT,
    "identityVersion" INTEGER NOT NULL DEFAULT 1,
    "provisionalKey" TEXT NOT NULL,
    "canonicalKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "observedInBaseline" BOOLEAN NOT NULL DEFAULT false,
    "firstObservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observationCount" INTEGER NOT NULL DEFAULT 0,
    "processingVersion" TEXT,
    "trustedPublishedAt" DATETIME,
    "dateProvenance" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "terminalReason" TEXT,
    "terminalAt" DATETIME,
    "ingestedAt" DATETIME,
    "articleDeletedAt" DATETIME,
    "articleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CrawlCandidate_discoverySourceId_fkey" FOREIGN KEY ("discoverySourceId") REFERENCES "DiscoverySource" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CrawlCandidate_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UrlAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "identityVersion" INTEGER NOT NULL DEFAULT 1,
    "aliasKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PROVISIONAL',
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UrlAlias_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CrawlCandidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiscoveryObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discoverySourceId" TEXT NOT NULL,
    "candidateId" TEXT,
    "runId" TEXT,
    "identityVersion" INTEGER NOT NULL DEFAULT 1,
    "observationKey" TEXT NOT NULL,
    "observedCanonicalKey" TEXT,
    "positionRank" INTEGER,
    "httpStatus" INTEGER,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscoveryObservation_discoverySourceId_fkey" FOREIGN KEY ("discoverySourceId") REFERENCES "DiscoverySource" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DiscoveryObservation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CrawlCandidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CanonicalConflict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerKey" TEXT NOT NULL,
    "identityVersion" INTEGER NOT NULL DEFAULT 1,
    "canonicalKey" TEXT NOT NULL,
    "challengerKey" TEXT NOT NULL,
    "incumbentCandidateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reason" TEXT,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "resolvedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CanonicalConflict_incumbentCandidateId_fkey" FOREIGN KEY ("incumbentCandidateId") REFERENCES "CrawlCandidate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
