-- Draft/scheduled publish lifecycle for assignments (#1275, W2-6).
ALTER TABLE "Assignment" ADD COLUMN "publishState" TEXT NOT NULL DEFAULT 'published';
ALTER TABLE "Assignment" ADD COLUMN "publishAt" DATETIME;
