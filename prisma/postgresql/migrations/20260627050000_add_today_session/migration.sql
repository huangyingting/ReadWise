-- Migration: add_today_session (PostgreSQL)
-- Adds the TodaySession table: one durable workflow anchor per learner-local
-- day (#783/#788). Stores ids/anchors only (article ids, saved-word ids,
-- controlled statuses, timestamps) — never learning content. Article/saved-word
-- ids are plain TEXT (not FKs) revalidated in code, so deleting an Article or
-- SavedWord never cascades here; only user deletion cascades. Controlled
-- string fields are TEXT (not enums), matching the single-source schema intent.

-- CreateTable
CREATE TABLE "TodaySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "timezoneSnapshot" TEXT NOT NULL,
    "primaryArticleId" TEXT,
    "backupArticleIds" JSONB NOT NULL DEFAULT '[]',
    "targetSavedWordIds" JSONB NOT NULL DEFAULT '[]',
    "reviewTargetCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'none',
    "completionTier" TEXT NOT NULL DEFAULT 'none',
    "generationReasonCode" TEXT NOT NULL DEFAULT 'no_candidate',
    "readingCompletedAt" TIMESTAMP(3),
    "comprehensionCompletedAt" TIMESTAMP(3),
    "wordReviewCompletedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "skipReason" TEXT,
    "skippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TodaySession_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TodaySession" ADD CONSTRAINT "TodaySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "TodaySession_userId_localDate_key" ON "TodaySession"("userId", "localDate");

-- CreateIndex
CREATE INDEX "TodaySession_userId_idx" ON "TodaySession"("userId");
