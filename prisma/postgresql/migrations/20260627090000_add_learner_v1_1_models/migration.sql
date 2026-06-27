-- Migration: add_learner_v1_1_models (PostgreSQL)
-- Schema foundation for the v1.1/v2 learner features (#806/#807/#809/#810/#813).
-- Additive only: adds Profile.goalPath plus five new tables that store
-- STRUCTURED OUTCOMES, IDS, COUNTS, and CONTROLLED STRING values ONLY — never
-- learning content (no passage/article/answer/option/question/prompt/note text,
-- definitions, or PII). Article ids, question ids, and Today-session ids are
-- plain TEXT (not FKs) revalidated in code, so deleting an Article, QuizQuestion,
-- or TodaySession never cascades here; only user deletion cascades (and series
-- deletion cascades SeriesEnrollment). Controlled string fields are TEXT (not new
-- Prisma enums), matching the ArticleDifficultyFeedback.vote / TodaySession
-- convention and keeping SQLite and PostgreSQL schemas in single-source sync.
-- `articleIds` is JSONB to mirror the SQLite Json column.
-- #811 (offline) needs no schema and is intentionally absent.

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "goalPath" TEXT;

-- CreateTable
CREATE TABLE "PlacementResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passageArticleId" TEXT NOT NULL,
    "seedLevel" TEXT NOT NULL,
    "recommendedLevel" TEXT NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "correctCount" INTEGER NOT NULL,
    "lookupCount" INTEGER NOT NULL,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "attempt" TEXT NOT NULL DEFAULT 'initial',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlacementResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TodayComprehensionFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "todaySessionId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "selfRating" TEXT NOT NULL,
    "questionId" TEXT,
    "mcqCorrect" BOOLEAN,
    "skillTag" TEXT,
    "remediationViewed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TodayComprehensionFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnerCoachMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "lastObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trend" TEXT NOT NULL DEFAULT 'stable',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerCoachMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadingSeries" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetLevelMin" TEXT,
    "targetLevelMax" TEXT,
    "topic" TEXT,
    "articleIds" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "public" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReadingSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeriesEnrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "nextIndex" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeriesEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlacementResult_userId_key" ON "PlacementResult"("userId");

-- CreateIndex
CREATE INDEX "PlacementResult_userId_idx" ON "PlacementResult"("userId");

-- CreateIndex
CREATE INDEX "TodayComprehensionFeedback_userId_idx" ON "TodayComprehensionFeedback"("userId");

-- CreateIndex
CREATE INDEX "TodayComprehensionFeedback_userId_articleId_idx" ON "TodayComprehensionFeedback"("userId", "articleId");

-- CreateIndex
CREATE INDEX "LearnerCoachMemory_userId_idx" ON "LearnerCoachMemory"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerCoachMemory_userId_skill_key" ON "LearnerCoachMemory"("userId", "skill");

-- CreateIndex
CREATE UNIQUE INDEX "ReadingSeries_slug_key" ON "ReadingSeries"("slug");

-- CreateIndex
CREATE INDEX "ReadingSeries_status_idx" ON "ReadingSeries"("status");

-- CreateIndex
CREATE INDEX "ReadingSeries_topic_idx" ON "ReadingSeries"("topic");

-- CreateIndex
CREATE INDEX "SeriesEnrollment_userId_idx" ON "SeriesEnrollment"("userId");

-- CreateIndex
CREATE INDEX "SeriesEnrollment_userId_status_idx" ON "SeriesEnrollment"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SeriesEnrollment_userId_seriesId_key" ON "SeriesEnrollment"("userId", "seriesId");

-- AddForeignKey
ALTER TABLE "PlacementResult" ADD CONSTRAINT "PlacementResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TodayComprehensionFeedback" ADD CONSTRAINT "TodayComprehensionFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerCoachMemory" ADD CONSTRAINT "LearnerCoachMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeriesEnrollment" ADD CONSTRAINT "SeriesEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeriesEnrollment" ADD CONSTRAINT "SeriesEnrollment_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "ReadingSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
