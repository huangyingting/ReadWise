-- Learning mastery foundation (Epic RW-E007 — RW-036/037/038).
-- Durable per-user mastery for WORDS, ARTICLES and SKILLS. These complement
-- (never replace) the activity tables they derive from. All three cascade with
-- their owning user; ArticleMastery also cascades with the article. JSON
-- columns use JSONB (SQLite stores it as text) for parity with the PostgreSQL
-- schema. METADATA ONLY — no prompt/sensitive content is ever stored.

-- CreateTable
CREATE TABLE "WordMastery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "lemma" TEXT NOT NULL,
    "familiarity" REAL NOT NULL DEFAULT 0,
    "exposures" INTEGER NOT NULL DEFAULT 0,
    "correctReviews" INTEGER NOT NULL DEFAULT 0,
    "incorrectReviews" INTEGER NOT NULL DEFAULT 0,
    "confidence" REAL NOT NULL DEFAULT 0,
    "sourceArticleIds" JSONB NOT NULL DEFAULT '[]',
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WordMastery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArticleMastery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "readingCompletion" REAL NOT NULL DEFAULT 0,
    "quizScore" REAL,
    "lookupDensity" REAL,
    "timeSpentMs" INTEGER,
    "difficultyFeedback" TEXT,
    "comprehensionScore" REAL NOT NULL DEFAULT 0,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArticleMastery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArticleMastery_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkillMastery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 0,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "recentEvidence" JSONB NOT NULL DEFAULT '[]',
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SkillMastery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
