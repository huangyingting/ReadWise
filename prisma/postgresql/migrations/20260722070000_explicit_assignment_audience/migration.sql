ALTER TABLE "Assignment"
ADD COLUMN "wholeClass" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Assignment"
SET "wholeClass" = false
WHERE EXISTS (
  SELECT 1
  FROM "AssignmentTarget"
  WHERE "AssignmentTarget"."assignmentId" = "Assignment"."id"
);
