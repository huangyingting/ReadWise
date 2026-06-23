-- CreateTable
CREATE TABLE "AiInvocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feature" TEXT NOT NULL,
    "model" TEXT,
    "promptVersion" TEXT,
    "userId" TEXT,
    "articleId" TEXT,
    "requestId" TEXT,
    "status" TEXT NOT NULL,
    "fallback" BOOLEAN NOT NULL DEFAULT false,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "estimatedCostUsd" REAL,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RateLimitCounter" (
    "bucketKey" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("bucketKey", "windowStart")
);

-- CreateIndex
CREATE INDEX "AiInvocation_feature_createdAt_idx" ON "AiInvocation"("feature", "createdAt");

-- CreateIndex
CREATE INDEX "AiInvocation_model_idx" ON "AiInvocation"("model");

-- CreateIndex
CREATE INDEX "AiInvocation_status_idx" ON "AiInvocation"("status");

-- CreateIndex
CREATE INDEX "AiInvocation_userId_idx" ON "AiInvocation"("userId");

-- CreateIndex
CREATE INDEX "RateLimitCounter_expiresAt_idx" ON "RateLimitCounter"("expiresAt");
