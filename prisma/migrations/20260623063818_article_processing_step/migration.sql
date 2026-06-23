-- Step-level article processing state (RW-016). A durable, per-article
-- per-step timeline of the enrichment pipeline. `step` is a feature label
-- (difficulty|tags|vocabulary|quiz|speech|grammar) or a language-scoped
-- translation key ("translation:es"). METADATA ONLY (model/prompt version + a
-- short error message); never prompt content. Real FK to Article (cascades).

-- CreateTable
CREATE TABLE "ArticleProcessingStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "modelName" TEXT,
    "promptVersion" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArticleProcessingStep_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ArticleProcessingStep_articleId_idx" ON "ArticleProcessingStep"("articleId");

-- CreateIndex
CREATE INDEX "ArticleProcessingStep_status_idx" ON "ArticleProcessingStep"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleProcessingStep_articleId_step_key" ON "ArticleProcessingStep"("articleId", "step");
