-- Draft/scheduled publish lifecycle for assignments (#1275, W2-6).
CREATE TYPE "AssignmentPublishState" AS ENUM ('draft', 'scheduled', 'published');
ALTER TABLE "Assignment" ADD COLUMN "publishState" "AssignmentPublishState" NOT NULL DEFAULT 'published';
ALTER TABLE "Assignment" ADD COLUMN "publishAt" TIMESTAMP(3);
