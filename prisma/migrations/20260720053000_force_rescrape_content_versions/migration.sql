-- SQLite migration for Phase 3.3 audited force-rescrape with Article content
-- versions (#1102).
--
-- Adds ONE durable table, ArticleContentVersion, that lets an audited,
-- operator-only force-rescrape refresh ONE known public Article by fetching +
-- validating a replacement into a PENDING row and, ONLY after every migration
-- gate passes, atomically ACTIVATING it while the previous ACTIVE version becomes
-- SUPERSEDED. A failed validation RETAINS the current ACTIVE version and records a
-- controlled REJECTED/FAILED row. The Article is UPDATED in place (id, ownership,
-- visibility, reading relationships, audit history preserved), never recreated.
--
-- ArticleContentVersionStatus is a plain TEXT column under SQLite, so the enum
-- needs NO type creation here — it is enforced by the Prisma client + the
-- PostgreSQL enum type.
--
-- CONCURRENCY (AC4) is DB-enforced by two nullable-unique slots
-- (`pendingForArticleId`, `activeForArticleId`) set only while a version occupies
-- that state; SQLite permits multiple NULLs in a UNIQUE column, so a second
-- concurrent force-rescrape that opens a PENDING version hits the unique conflict
-- and is rejected cleanly (neither version is lost), and at most one ACTIVE
-- version per Article is guaranteed.
--
-- PRIVACY: the versioned readable payload (content/title/urls) is product data
-- that lives ONLY on this authoritative row — NEVER in logs, audit metadata, Job
-- payloads, or error history. `requestedById` is a plain string (not an FK),
-- `reason` is sanitized operator justification, and `failureReason` is a machine
-- code only.

-- CreateTable
CREATE TABLE "ArticleContentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "content" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "excerpt" TEXT,
    "author" TEXT,
    "heroImage" TEXT,
    "source" TEXT,
    "category" TEXT,
    "wordCount" INTEGER,
    "readingMinutes" INTEGER,
    "sourceUrl" TEXT,
    "canonicalUrl" TEXT,
    "publishedAt" DATETIME,
    "fingerprint" TEXT,
    "fingerprintVersion" INTEGER,
    "extractorVersion" INTEGER,
    "requestedById" TEXT,
    "reason" TEXT NOT NULL,
    "failureReason" TEXT,
    "derivedRegenerationRequestedAt" DATETIME,
    "pendingForArticleId" TEXT,
    "activeForArticleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" DATETIME,
    "supersededAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArticleContentVersion_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ArticleContentVersion_pendingForArticleId_key" ON "ArticleContentVersion"("pendingForArticleId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleContentVersion_activeForArticleId_key" ON "ArticleContentVersion"("activeForArticleId");

-- CreateIndex
CREATE INDEX "ArticleContentVersion_articleId_idx" ON "ArticleContentVersion"("articleId");

-- CreateIndex
CREATE INDEX "ArticleContentVersion_articleId_status_idx" ON "ArticleContentVersion"("articleId", "status");

-- CreateIndex
CREATE INDEX "ArticleContentVersion_status_idx" ON "ArticleContentVersion"("status");
