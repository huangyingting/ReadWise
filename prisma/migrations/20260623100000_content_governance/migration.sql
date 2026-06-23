-- Content source governance, rights/takedown, quality review, media object
-- storage & provider health (Epic RW-E009 — RW-046..050). Adds operational
-- governance state (ContentSource), an append-only moderation/review history
-- (ContentReview), media object-storage metadata (MediaAsset), Article
-- rights/review columns, and makes ArticleSpeech.audioBase64 nullable so audio
-- can live in object storage (DB base64 stays as a graceful fallback).

-- AlterTable: Article rights/takedown (RW-047) + quality review (RW-048) columns.
ALTER TABLE "Article" ADD COLUMN "canonicalUrl" TEXT;
ALTER TABLE "Article" ADD COLUMN "takedownState" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "Article" ADD COLUMN "rightsNote" TEXT;
ALTER TABLE "Article" ADD COLUMN "reviewState" TEXT NOT NULL DEFAULT 'unreviewed';
ALTER TABLE "Article" ADD COLUMN "qualityFlags" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "Article_takedownState_idx" ON "Article"("takedownState");
CREATE INDEX "Article_reviewState_idx" ON "Article"("reviewState");

-- CreateTable: ContentSource (provider operational state + ingestion counters).
CREATE TABLE "ContentSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "baseUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "crawlPolicy" JSONB NOT NULL DEFAULT '{}',
    "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
    "lastError" TEXT,
    "lastCrawledAt" DATETIME,
    "lastDiscoveryCount" INTEGER NOT NULL DEFAULT 0,
    "totalDiscovered" INTEGER NOT NULL DEFAULT 0,
    "totalScraped" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "totalDuplicates" INTEGER NOT NULL DEFAULT 0,
    "totalRejected" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "consecutiveZeroDiscovery" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentSource_providerKey_key" ON "ContentSource"("providerKey");
CREATE INDEX "ContentSource_enabled_idx" ON "ContentSource"("enabled");
CREATE INDEX "ContentSource_healthStatus_idx" ON "ContentSource"("healthStatus");

-- CreateTable: ContentReview (append-only moderation/review history). reviewerId
-- is a plain string (non-FK) so history survives reviewer deletion.
CREATE TABLE "ContentReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentReview_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ContentReview_articleId_createdAt_idx" ON "ContentReview"("articleId", "createdAt");
CREATE INDEX "ContentReview_action_createdAt_idx" ON "ContentReview"("action", "createdAt");

-- CreateTable: MediaAsset (object-storage metadata, RW-049). Cascades with the
-- article so deleting an article cleans up its media rows.
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storageKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'speech',
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "durationSec" REAL,
    "voice" TEXT,
    "format" TEXT,
    "articleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MediaAsset_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");
CREATE INDEX "MediaAsset_articleId_idx" ON "MediaAsset"("articleId");
CREATE INDEX "MediaAsset_kind_createdAt_idx" ON "MediaAsset"("kind", "createdAt");

-- AlterTable: ArticleSpeech — make audioBase64 nullable + add object-storage
-- pointers (storageKey, mediaAssetId). SQLite cannot drop a NOT NULL constraint
-- in place, so rebuild the table; existing base64 rows are preserved verbatim.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_ArticleSpeech" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "voice" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "audioBase64" TEXT,
    "storageKey" TEXT,
    "mediaAssetId" TEXT,
    "spokenText" TEXT NOT NULL,
    "words" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArticleSpeech_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ArticleSpeech" ("id", "articleId", "voice", "format", "mimeType", "audioBase64", "spokenText", "words", "createdAt", "updatedAt")
SELECT "id", "articleId", "voice", "format", "mimeType", "audioBase64", "spokenText", "words", "createdAt", "updatedAt" FROM "ArticleSpeech";
DROP TABLE "ArticleSpeech";
ALTER TABLE "new_ArticleSpeech" RENAME TO "ArticleSpeech";
CREATE UNIQUE INDEX "ArticleSpeech_articleId_key" ON "ArticleSpeech"("articleId");

PRAGMA foreign_keys=ON;
