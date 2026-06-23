-- Step-level article processing state (RW-016). Mirrors the SQLite migration.
-- Timestamps are TIMESTAMP(3); the FK to Article cascades on delete. `step` is
-- a feature label (difficulty|tags|vocabulary|quiz|speech|grammar) or a
-- language-scoped translation key ("translation:es"). METADATA ONLY — model /
-- prompt version + a short error message; never prompt content.

-- CreateTable
CREATE TABLE "ArticleProcessingStep" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "modelName" TEXT,
    "promptVersion" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleProcessingStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArticleProcessingStep_articleId_idx" ON "ArticleProcessingStep"("articleId");

-- CreateIndex
CREATE INDEX "ArticleProcessingStep_status_idx" ON "ArticleProcessingStep"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleProcessingStep_articleId_step_key" ON "ArticleProcessingStep"("articleId", "step");

-- AddForeignKey
ALTER TABLE "ArticleProcessingStep" ADD CONSTRAINT "ArticleProcessingStep_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
