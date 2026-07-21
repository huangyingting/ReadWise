-- Add classroom archival timestamp for soft lifecycle hiding.
ALTER TABLE "Classroom" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Classroom_orgId_archivedAt_idx" ON "Classroom"("orgId", "archivedAt");
