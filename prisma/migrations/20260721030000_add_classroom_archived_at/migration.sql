-- Add classroom archival timestamp for soft lifecycle hiding.
ALTER TABLE "Classroom" ADD COLUMN "archivedAt" DATETIME;

CREATE INDEX "Classroom_orgId_archivedAt_idx" ON "Classroom"("orgId", "archivedAt");
