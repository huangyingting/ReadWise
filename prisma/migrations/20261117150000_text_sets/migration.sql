-- CreateTable
CREATE TABLE "TextSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT,
    "title" TEXT NOT NULL,
    "essentialQuestion" TEXT,
    "description" TEXT,
    "educatorNotes" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TextSet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TextSet_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TextSetItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "textSetId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "guidingNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TextSetItem_textSetId_fkey" FOREIGN KEY ("textSetId") REFERENCES "TextSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TextSetItem_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Assignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "wholeClass" BOOLEAN NOT NULL DEFAULT true,
    "everTargeted" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" DATETIME,
    "instructions" TEXT,
    "title" TEXT,
    "points" INTEGER,
    "publishState" TEXT NOT NULL DEFAULT 'published',
    "publishAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "textSetId" TEXT,
    CONSTRAINT "Assignment_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Assignment_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Assignment_textSetId_fkey" FOREIGN KEY ("textSetId") REFERENCES "TextSet" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Assignment" ("articleId", "classroomId", "createdAt", "dueDate", "everTargeted", "id", "instructions", "points", "publishAt", "publishState", "title", "updatedAt", "wholeClass") SELECT "articleId", "classroomId", "createdAt", "dueDate", "everTargeted", "id", "instructions", "points", "publishAt", "publishState", "title", "updatedAt", "wholeClass" FROM "Assignment";
DROP TABLE "Assignment";
ALTER TABLE "new_Assignment" RENAME TO "Assignment";
CREATE INDEX "Assignment_classroomId_idx" ON "Assignment"("classroomId");
CREATE INDEX "Assignment_articleId_idx" ON "Assignment"("articleId");
CREATE INDEX "Assignment_classroomId_textSetId_idx" ON "Assignment"("classroomId", "textSetId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TextSet_organizationId_visibility_idx" ON "TextSet"("organizationId", "visibility");

-- CreateIndex
CREATE INDEX "TextSet_ownerId_idx" ON "TextSet"("ownerId");

-- CreateIndex
CREATE INDEX "TextSetItem_textSetId_position_idx" ON "TextSetItem"("textSetId", "position");

-- CreateIndex
CREATE INDEX "TextSetItem_articleId_idx" ON "TextSetItem"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "TextSetItem_textSetId_articleId_key" ON "TextSetItem"("textSetId", "articleId");

