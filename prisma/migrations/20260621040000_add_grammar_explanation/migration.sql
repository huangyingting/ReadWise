-- CreateTable
CREATE TABLE "GrammarExplanation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GrammarExplanation_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GrammarExplanation_articleId_phrase_key" ON "GrammarExplanation"("articleId", "phrase");

-- CreateIndex
CREATE INDEX "GrammarExplanation_articleId_idx" ON "GrammarExplanation"("articleId");
