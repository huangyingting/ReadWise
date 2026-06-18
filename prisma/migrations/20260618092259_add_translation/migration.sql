-- CreateTable
CREATE TABLE "Translation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Translation_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Translation_articleId_idx" ON "Translation"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "Translation_articleId_targetLang_key" ON "Translation"("articleId", "targetLang");
