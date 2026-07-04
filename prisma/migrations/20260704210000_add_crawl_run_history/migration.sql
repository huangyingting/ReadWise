-- CreateTable
CREATE TABLE "CrawlRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "durationMs" INTEGER,
    "discovered" INTEGER NOT NULL DEFAULT 0,
    "scraped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "CrawlRun_providerKey_createdAt_idx" ON "CrawlRun"("providerKey", "createdAt");

-- CreateIndex
CREATE INDEX "CrawlRun_outcome_createdAt_idx" ON "CrawlRun"("outcome", "createdAt");
