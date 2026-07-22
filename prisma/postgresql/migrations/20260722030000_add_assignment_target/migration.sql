-- Per-student assignment targeting (GAP-3, #1247). Zero rows for an assignment = whole classroom.
CREATE TABLE "AssignmentTarget" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentTarget_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AssignmentTarget" ADD CONSTRAINT "AssignmentTarget_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentTarget" ADD CONSTRAINT "AssignmentTarget_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "AssignmentTarget_assignmentId_studentId_key" ON "AssignmentTarget"("assignmentId", "studentId");
CREATE INDEX "AssignmentTarget_studentId_idx" ON "AssignmentTarget"("studentId");
CREATE INDEX "AssignmentTarget_assignmentId_idx" ON "AssignmentTarget"("assignmentId");
