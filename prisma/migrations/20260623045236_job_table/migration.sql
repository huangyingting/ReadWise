-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "runAfter" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "lockedAt" DATETIME,
    "lastError" TEXT,
    "errorHistory" JSONB NOT NULL,
    "dedupeKey" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "failedAt" DATETIME,
    "deadLetteredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_status_runAfter_idx" ON "Job"("status", "runAfter");

-- CreateIndex
CREATE INDEX "Job_status_type_runAfter_idx" ON "Job"("status", "type", "runAfter");

-- CreateIndex
CREATE INDEX "Job_type_status_idx" ON "Job"("type", "status");

-- CreateIndex
CREATE INDEX "Job_lockedBy_idx" ON "Job"("lockedBy");

-- CreateIndex
CREATE INDEX "Job_lockedAt_idx" ON "Job"("lockedAt");
