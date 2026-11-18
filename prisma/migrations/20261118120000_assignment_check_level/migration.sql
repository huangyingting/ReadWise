-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AssignmentCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assignmentId" TEXT NOT NULL,
    "afterBlock" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "explanation" TEXT,
    "levelKey" TEXT NOT NULL DEFAULT 'original',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssignmentCheck_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AssignmentCheck" ("afterBlock", "assignmentId", "correctIndex", "createdAt", "createdById", "explanation", "id", "options", "question", "updatedAt") SELECT "afterBlock", "assignmentId", "correctIndex", "createdAt", "createdById", "explanation", "id", "options", "question", "updatedAt" FROM "AssignmentCheck";
DROP TABLE "AssignmentCheck";
ALTER TABLE "new_AssignmentCheck" RENAME TO "AssignmentCheck";
CREATE INDEX "AssignmentCheck_assignmentId_afterBlock_idx" ON "AssignmentCheck"("assignmentId", "afterBlock");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

