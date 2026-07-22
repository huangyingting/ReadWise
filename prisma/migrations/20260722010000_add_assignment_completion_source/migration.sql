-- Track how an assignment completion was produced (GAP-6, #1250): self-marked, reading-progress, or quiz.
ALTER TABLE "AssignmentCompletion" ADD COLUMN "completionSource" TEXT;
