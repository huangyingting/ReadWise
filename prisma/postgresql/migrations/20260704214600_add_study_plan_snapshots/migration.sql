-- Migration: add_study_plan_snapshots (PostgreSQL)
-- #903 persists one derived weekly study-plan snapshot per learner/week.
-- Rows contain only plan metadata, controlled weak-area summaries, item links,
-- and aggregate evidence. They must not contain raw article text, selected text,
-- definitions, translations, prompts, generated AI text, tokens, or credentials.

-- CreateTable
CREATE TABLE "StudyPlanSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT NOT NULL,
    "isStarter" BOOLEAN NOT NULL DEFAULT false,
    "weakAreas" JSONB NOT NULL DEFAULT '[]',
    "items" JSONB NOT NULL DEFAULT '[]',
    "sourceVersion" TEXT NOT NULL DEFAULT 'study-plan-v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyPlanSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudyPlanSnapshot_userId_weekStart_key" ON "StudyPlanSnapshot"("userId", "weekStart");

-- CreateIndex
CREATE INDEX "StudyPlanSnapshot_userId_generatedAt_idx" ON "StudyPlanSnapshot"("userId", "generatedAt");

-- AddForeignKey
ALTER TABLE "StudyPlanSnapshot" ADD CONSTRAINT "StudyPlanSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
