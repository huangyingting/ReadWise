-- CreateTable
CREATE TABLE "SentenceTranslation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SentenceTranslation_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SentenceTranslation_articleId_idx" ON "SentenceTranslation"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "SentenceTranslation_articleId_sourceHash_targetLang_key" ON "SentenceTranslation"("articleId", "sourceHash", "targetLang");
