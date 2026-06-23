-- Product analytics event model (Epic RW-E010 — RW-051). A general-purpose,
-- append-only product analytics stream that COMPLEMENTS the domain tables and
-- powers funnel/activation/retention analysis (RW-052). METADATA ONLY — the
-- `properties` JSON holds small non-sensitive metadata, never article/selected
-- text or PII. `userId`/`articleId` are plain string refs (NOT FKs, like
-- AuditLog/AiInvocation) so events survive user/article deletion; privacy is
-- enforced by the documented retention window + an explicit per-user purge.

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "anonymousId" TEXT,
    "articleId" TEXT,
    "sessionId" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AnalyticsEvent_type_occurredAt_idx" ON "AnalyticsEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_occurredAt_idx" ON "AnalyticsEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_occurredAt_idx" ON "AnalyticsEvent"("occurredAt");
