-- CreateTable
CREATE TABLE "QuizAttemptAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT,
    "questionIndex" INTEGER NOT NULL,
    "skillTag" TEXT NOT NULL,
    "selectedIndex" INTEGER NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuizAttemptAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "QuizAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuizAttemptAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuizQuestion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "source" TEXT,
    "sourceUrl" TEXT,
    "heroImage" TEXT,
    "excerpt" TEXT,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "wordCount" INTEGER,
    "readingMinutes" INTEGER,
    "difficulty" TEXT,
    "difficultyScore" REAL,
    "lexileApprox" INTEGER,
    "maturityBand" TEXT NOT NULL DEFAULT 'general',
    "difficultyVersion" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "status" TEXT NOT NULL DEFAULT 'published',
    "sourceType" TEXT NOT NULL DEFAULT 'SCRAPED',
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT,
    "canonicalUrl" TEXT,
    "takedownState" TEXT NOT NULL DEFAULT 'active',
    "rightsNote" TEXT,
    "reviewState" TEXT NOT NULL DEFAULT 'unreviewed',
    "qualityFlags" JSONB NOT NULL DEFAULT [],
    "organizationId" TEXT,
    CONSTRAINT "Article_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Article" ("author", "canonicalUrl", "category", "content", "createdAt", "difficulty", "difficultyScore", "difficultyVersion", "excerpt", "heroImage", "id", "lexileApprox", "organizationId", "ownerId", "publishedAt", "qualityFlags", "readingMinutes", "reviewState", "rightsNote", "slug", "source", "sourceType", "sourceUrl", "status", "takedownState", "title", "updatedAt", "visibility", "wordCount") SELECT "author", "canonicalUrl", "category", "content", "createdAt", "difficulty", "difficultyScore", "difficultyVersion", "excerpt", "heroImage", "id", "lexileApprox", "organizationId", "ownerId", "publishedAt", "qualityFlags", "readingMinutes", "reviewState", "rightsNote", "slug", "source", "sourceType", "sourceUrl", "status", "takedownState", "title", "updatedAt", "visibility", "wordCount" FROM "Article";
DROP TABLE "Article";
ALTER TABLE "new_Article" RENAME TO "Article";
CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");
CREATE INDEX "Article_category_idx" ON "Article"("category");
CREATE INDEX "Article_ownerId_idx" ON "Article"("ownerId");
CREATE INDEX "Article_organizationId_idx" ON "Article"("organizationId");
CREATE INDEX "Article_sourceUrl_idx" ON "Article"("sourceUrl");
CREATE INDEX "Article_visibility_feed_idx" ON "Article"("visibility", "status", "ownerId", "publishedAt", "createdAt");
CREATE INDEX "Article_category_feed_idx" ON "Article"("visibility", "status", "ownerId", "category", "publishedAt", "createdAt");
CREATE INDEX "Article_owner_status_created_idx" ON "Article"("ownerId", "status", "createdAt");
CREATE INDEX "Article_status_created_idx" ON "Article"("status", "createdAt");
CREATE INDEX "Article_level_feed_idx" ON "Article"("visibility", "status", "ownerId", "difficulty", "difficultyScore", "publishedAt");
CREATE INDEX "Article_takedownState_idx" ON "Article"("takedownState");
CREATE INDEX "Article_maturityBand_idx" ON "Article"("maturityBand");
CREATE INDEX "Article_reviewState_idx" ON "Article"("reviewState");
CREATE UNIQUE INDEX "Article_sourceUrl_ownerId_key" ON "Article"("sourceUrl", "ownerId");
CREATE TABLE "new_QuizQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "skillTag" TEXT NOT NULL DEFAULT 'textual_evidence',
    "standardCode" TEXT,
    "explanation" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuizQuestion_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_QuizQuestion" ("articleId", "correctIndex", "createdAt", "id", "options", "question", "updatedAt") SELECT "articleId", "correctIndex", "createdAt", "id", "options", "question", "updatedAt" FROM "QuizQuestion";
DROP TABLE "QuizQuestion";
ALTER TABLE "new_QuizQuestion" RENAME TO "QuizQuestion";
CREATE INDEX "QuizQuestion_articleId_idx" ON "QuizQuestion"("articleId");
CREATE INDEX "QuizQuestion_skillTag_articleId_idx" ON "QuizQuestion"("skillTag", "articleId");
CREATE UNIQUE INDEX "QuizQuestion_articleId_question_key" ON "QuizQuestion"("articleId", "question");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "QuizAttemptAnswer_questionId_idx" ON "QuizAttemptAnswer"("questionId");

-- CreateIndex
CREATE INDEX "QuizAttemptAnswer_skillTag_idx" ON "QuizAttemptAnswer"("skillTag");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAttemptAnswer_attemptId_questionIndex_key" ON "QuizAttemptAnswer"("attemptId", "questionIndex");


-- Backfill (#1302): classify existing questions with the same ordered keyword
-- rules as classifyQuestionSkill() in src/lib/learning/reading-skills.ts, then
-- derive each question's anchor standard.
UPDATE "QuizQuestion" SET "skillTag" = CASE
  WHEN lower("question") LIKE '%closest in meaning%'
       OR lower("question") LIKE '%the word%'
       OR lower("question") LIKE '%the phrase%'
       OR lower("question") LIKE '%the term%'
       OR lower("question") LIKE '%meaning of%'
       OR lower("question") LIKE '%most likely means%'
       OR lower("question") LIKE '%mean?%'
       OR lower("question") LIKE '%means?%'
       OR lower("question") LIKE '%definition%'
    THEN 'vocabulary_in_context'
  WHEN lower("question") LIKE '%main idea%'
       OR lower("question") LIKE '%central idea%'
       OR lower("question") LIKE '%mainly about%'
       OR lower("question") LIKE '%mostly about%'
       OR lower("question") LIKE '%primarily about%'
       OR lower("question") LIKE '%main point%'
       OR lower("question") LIKE '%summary%'
       OR lower("question") LIKE '%summarize%'
       OR lower("question") LIKE '%best title%'
    THEN 'main_idea'
  WHEN lower("question") LIKE '%argue%'
       OR lower("question") LIKE '%argument%'
       OR lower("question") LIKE '%claim%'
       OR lower("question") LIKE '%convince%'
       OR lower("question") LIKE '%persuade%'
    THEN 'argument'
  WHEN lower("question") LIKE '%purpose%'
       OR lower("question") LIKE '%point of view%'
       OR lower("question") LIKE '%perspective%'
       OR lower("question") LIKE '%the tone%'
       OR lower("question") LIKE '%tone of%'
       OR lower("question") LIKE '%attitude%'
       OR lower("question") LIKE '%why did the author%'
       OR lower("question") LIKE '%why does the author%'
    THEN 'point_of_view'
  WHEN lower("question") LIKE '%why%'
       OR lower("question") LIKE '%cause%'
       OR lower("question") LIKE '%because%'
       OR lower("question") LIKE '%result%'
       OR lower("question") LIKE '%effect%'
       OR lower("question") LIKE '%lead to%'
       OR lower("question") LIKE '%led to%'
       OR lower("question") LIKE '%consequence%'
    THEN 'cause_effect'
  ELSE 'textual_evidence'
END;

UPDATE "QuizQuestion" SET "standardCode" = CASE "skillTag"
  WHEN 'textual_evidence' THEN 'CCRA.R.1'
  WHEN 'main_idea' THEN 'CCRA.R.2'
  WHEN 'cause_effect' THEN 'CCRA.R.3'
  WHEN 'vocabulary_in_context' THEN 'CCRA.R.4'
  WHEN 'point_of_view' THEN 'CCRA.R.6'
  WHEN 'argument' THEN 'CCRA.R.8'
END;
