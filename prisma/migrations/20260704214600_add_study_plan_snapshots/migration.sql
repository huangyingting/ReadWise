-- Migration: add_study_plan_snapshots (SQLite)
-- #903 persists one derived weekly study-plan snapshot per learner/week.
-- Rows contain only plan metadata, controlled weak-area summaries, item links,
-- and aggregate evidence. They must not contain raw article text, selected text,
-- definitions, translations, prompts, generated AI text, tokens, or credentials.

-- CreateTable
CREATE TABLE "StudyPlanSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "weekStart" DATETIME NOT NULL,
    "weekEnd" DATETIME NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT NOT NULL,
    "isStarter" BOOLEAN NOT NULL DEFAULT false,
    "weakAreas" JSONB NOT NULL DEFAULT '[]',
    "items" JSONB NOT NULL DEFAULT '[]',
    "sourceVersion" TEXT NOT NULL DEFAULT 'study-plan-v1',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StudyPlanSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StudyPlanSnapshot_userId_weekStart_key" ON "StudyPlanSnapshot"("userId", "weekStart");

-- CreateIndex
CREATE INDEX "StudyPlanSnapshot_userId_generatedAt_idx" ON "StudyPlanSnapshot"("userId", "generatedAt");
