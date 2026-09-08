ALTER TABLE "Assignment"
ADD COLUMN "everTargeted" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Assignment"
SET "everTargeted" = true
WHERE "wholeClass" = false
   OR EXISTS (
     SELECT 1
     FROM "AssignmentTarget"
     WHERE "AssignmentTarget"."assignmentId" = "Assignment"."id"
   )
   OR EXISTS (
     SELECT 1
     FROM "AssignmentCompletion"
     WHERE "AssignmentCompletion"."assignmentId" = "Assignment"."id"
   );
