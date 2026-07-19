-- SQLite migration for Phase 2.4 hostname/provider budgets, fairness, priorities
-- & cost budgets (#1094).
--
-- Two durable tables back the pure rate governor:
--   - ScraperBudgetWindow: per-(scope, scopeKey, utcDay) daily-windowed request
--     counter (hostname daily ceiling, per-provider quota, and the separate
--     discovery/body/AI cost budgets). A new UTC day starts a fresh counter.
--   - HostnameGovernorState: cross-day per-hostname min-interval anchor, auto-
--     pause window, and consecutive-error streak (survives a worker restart).
--
-- METADATA ONLY: scope/scopeKey/hostKey are opaque sanitized labels + counts +
-- timestamps + machine reason codes; NEVER a raw URL, query string, secret,
-- cookie, or article/user content.

-- CreateTable
CREATE TABLE "ScraperBudgetWindow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "utcDay" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "HostnameGovernorState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostKey" TEXT NOT NULL,
    "lastRequestAt" DATETIME,
    "pausedUntil" DATETIME,
    "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
    "lastFailureReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ScraperBudgetWindow_scope_scopeKey_utcDay_key" ON "ScraperBudgetWindow"("scope", "scopeKey", "utcDay");

-- CreateIndex
CREATE INDEX "ScraperBudgetWindow_scope_utcDay_idx" ON "ScraperBudgetWindow"("scope", "utcDay");

-- CreateIndex
CREATE UNIQUE INDEX "HostnameGovernorState_hostKey_key" ON "HostnameGovernorState"("hostKey");

-- CreateIndex
CREATE INDEX "HostnameGovernorState_pausedUntil_idx" ON "HostnameGovernorState"("pausedUntil");
