-- Add teacher feedback + review metadata to assignment completions (GAP-2).
ALTER TABLE "AssignmentCompletion" ADD COLUMN "feedback" TEXT;
ALTER TABLE "AssignmentCompletion" ADD COLUMN "reviewedAt" DATETIME;
ALTER TABLE "AssignmentCompletion" ADD COLUMN "reviewedBy" TEXT;
