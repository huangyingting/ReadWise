-- Content source governance, rights/takedown, quality review, media object
-- storage & provider health (Epic RW-E009 — RW-046..050). Mirrors the SQLite
-- migration. Timestamps are TIMESTAMP(3); JSON columns are JSONB; FKs cascade
-- (ContentReview/MediaAsset with the article). ContentSource holds operational
-- provider state only. ArticleSpeech.audioBase64 becomes nullable so audio can
-- live in object storage (DB base64 stays as a graceful fallback).

-- AlterTable: Article rights/takedown (RW-047) + quality review (RW-048) columns.
ALTER TABLE "Article" ADD COLUMN "canonicalUrl" TEXT;
ALTER TABLE "Article" ADD COLUMN "takedownState" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "Article" ADD COLUMN "rightsNote" TEXT;
ALTER TABLE "Article" ADD COLUMN "reviewState" TEXT NOT NULL DEFAULT 'unreviewed';
ALTER TABLE "Article" ADD COLUMN "qualityFlags" JSONB NOT NULL DEFAULT '[]';

-- AlterTable: ArticleSpeech — make audioBase64 nullable + add object-storage
-- pointers (storageKey, mediaAssetId).
ALTER TABLE "ArticleSpeech" ALTER COLUMN "audioBase64" DROP NOT NULL;
ALTER TABLE "ArticleSpeech" ADD COLUMN "storageKey" TEXT;
ALTER TABLE "ArticleSpeech" ADD COLUMN "mediaAssetId" TEXT;

-- CreateTable: ContentSource (provider operational state + ingestion counters).
CREATE TABLE "ContentSource" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "baseUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "crawlPolicy" JSONB NOT NULL DEFAULT '{}',
    "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
    "lastError" TEXT,
    "lastCrawledAt" TIMESTAMP(3),
    "lastDiscoveryCount" INTEGER NOT NULL DEFAULT 0,
    "totalDiscovered" INTEGER NOT NULL DEFAULT 0,
    "totalScraped" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "totalDuplicates" INTEGER NOT NULL DEFAULT 0,
    "totalRejected" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "consecutiveZeroDiscovery" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ContentReview (append-only moderation/review history). reviewerId
-- is a plain string (non-FK) so history survives reviewer deletion.
CREATE TABLE "ContentReview" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable: MediaAsset (object-storage metadata, RW-049). Cascades with the
-- article so deleting an article cleans up its media rows.
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'speech',
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION,
    "voice" TEXT,
    "format" TEXT,
    "articleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Article_takedownState_idx" ON "Article"("takedownState");

-- CreateIndex
CREATE INDEX "Article_reviewState_idx" ON "Article"("reviewState");

-- CreateIndex
CREATE UNIQUE INDEX "ContentSource_providerKey_key" ON "ContentSource"("providerKey");

-- CreateIndex
CREATE INDEX "ContentSource_enabled_idx" ON "ContentSource"("enabled");

-- CreateIndex
CREATE INDEX "ContentSource_healthStatus_idx" ON "ContentSource"("healthStatus");

-- CreateIndex
CREATE INDEX "ContentReview_articleId_createdAt_idx" ON "ContentReview"("articleId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentReview_action_createdAt_idx" ON "ContentReview"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");

-- CreateIndex
CREATE INDEX "MediaAsset_articleId_idx" ON "MediaAsset"("articleId");

-- CreateIndex
CREATE INDEX "MediaAsset_kind_createdAt_idx" ON "MediaAsset"("kind", "createdAt");

-- AddForeignKey
ALTER TABLE "ContentReview" ADD CONSTRAINT "ContentReview_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
