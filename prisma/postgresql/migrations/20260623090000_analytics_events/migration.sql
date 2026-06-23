-- Product analytics event model (Epic RW-E010 — RW-051). Mirrors the SQLite
-- migration. Timestamps are TIMESTAMP(3); `properties` is JSONB. `userId`/
-- `articleId` are plain string refs (NOT FKs, like AuditLog/AiInvocation) so
-- events survive user/article deletion; privacy is enforced by the documented
-- retention window + an explicit per-user purge. METADATA ONLY.

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "anonymousId" TEXT,
    "articleId" TEXT,
    "sessionId" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsEvent_type_occurredAt_idx" ON "AnalyticsEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_occurredAt_idx" ON "AnalyticsEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_occurredAt_idx" ON "AnalyticsEvent"("occurredAt");
