-- CreateTable
CREATE TABLE "ArticleDifficultyFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "vote" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArticleDifficultyFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArticleDifficultyFeedback_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ArticleDifficultyFeedback_userId_articleId_key" ON "ArticleDifficultyFeedback"("userId", "articleId");

-- CreateIndex
CREATE INDEX "ArticleDifficultyFeedback_articleId_idx" ON "ArticleDifficultyFeedback"("articleId");
