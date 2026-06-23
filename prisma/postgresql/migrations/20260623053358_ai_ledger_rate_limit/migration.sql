-- AI invocation ledger (RW-019) + shared rate-limit counter (RW-026).
-- Mirrors the SQLite migration. `estimatedCostUsd` is DOUBLE PRECISION (Prisma
-- Float). `userId`/`articleId`/`requestId` are plain TEXT identifiers (NOT FKs,
-- like AuditLog/Job) so the ledger survives entity deletion. The shared
-- rate-limit counter is keyed by a composite (bucketKey, windowStart) primary
-- key; an atomic upsert increments `count` within a fixed window.

-- CreateTable
CREATE TABLE "AiInvocation" (
    "id" TEXT NOT NULL,
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
    "estimatedCostUsd" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitCounter" (
    "bucketKey" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("bucketKey", "windowStart")
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
