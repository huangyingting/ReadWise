-- RW-E008 offline sync (RW-042 / RW-045). All additive.
--  - QuizAttempt.clientMutationId: idempotency key for offline-queued re-syncs.
--  - PushSubscription delivery tracking columns (reliable pruning + observability).
--  - ReminderPreference: per-user reminder timing + quiet hours (cascades with user).

-- AlterTable
ALTER TABLE "QuizAttempt" ADD COLUMN "clientMutationId" TEXT;

-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN "failureCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PushSubscription" ADD COLUMN "lastSuccessAt" DATETIME;
ALTER TABLE "PushSubscription" ADD COLUMN "lastFailureAt" DATETIME;

-- CreateTable
CREATE TABLE "ReminderPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "preferredHour" INTEGER,
    "quietHoursStart" INTEGER,
    "quietHoursEnd" INTEGER,
    "timezone" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReminderPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "QuizAttempt_clientMutationId_key" ON "QuizAttempt"("clientMutationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderPreference_userId_key" ON "ReminderPreference"("userId");
