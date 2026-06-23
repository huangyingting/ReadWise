-- Learning mastery foundation (Epic RW-E007 — RW-036/037/038). Mirrors the
-- SQLite migration. Timestamps are TIMESTAMP(3); JSON columns are JSONB; FKs
-- cascade (WordMastery/SkillMastery with the user, ArticleMastery with both
-- the user and the article). METADATA ONLY — no prompt/sensitive content.

-- CreateTable
CREATE TABLE "WordMastery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lemma" TEXT NOT NULL,
    "familiarity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "exposures" INTEGER NOT NULL DEFAULT 0,
    "correctReviews" INTEGER NOT NULL DEFAULT 0,
    "incorrectReviews" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceArticleIds" JSONB NOT NULL DEFAULT '[]',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WordMastery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleMastery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "readingCompletion" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quizScore" DOUBLE PRECISION,
    "lookupDensity" DOUBLE PRECISION,
    "timeSpentMs" INTEGER,
    "difficultyFeedback" TEXT,
    "comprehensionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleMastery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillMastery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "recentEvidence" JSONB NOT NULL DEFAULT '[]',
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillMastery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WordMastery_userId_idx" ON "WordMastery"("userId");

-- CreateIndex
CREATE INDEX "WordMastery_userId_familiarity_idx" ON "WordMastery"("userId", "familiarity");

-- CreateIndex
CREATE INDEX "WordMastery_userId_lastSeenAt_idx" ON "WordMastery"("userId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "WordMastery_userId_lemma_key" ON "WordMastery"("userId", "lemma");

-- CreateIndex
CREATE INDEX "ArticleMastery_userId_idx" ON "ArticleMastery"("userId");

-- CreateIndex
CREATE INDEX "ArticleMastery_articleId_idx" ON "ArticleMastery"("articleId");

-- CreateIndex
CREATE INDEX "ArticleMastery_userId_lastActivityAt_idx" ON "ArticleMastery"("userId", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleMastery_userId_articleId_key" ON "ArticleMastery"("userId", "articleId");

-- CreateIndex
CREATE INDEX "SkillMastery_userId_idx" ON "SkillMastery"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillMastery_userId_skill_key" ON "SkillMastery"("userId", "skill");

-- AddForeignKey
ALTER TABLE "WordMastery" ADD CONSTRAINT "WordMastery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleMastery" ADD CONSTRAINT "ArticleMastery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleMastery" ADD CONSTRAINT "ArticleMastery_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillMastery" ADD CONSTRAINT "SkillMastery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
