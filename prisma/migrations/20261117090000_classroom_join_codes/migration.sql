-- CreateTable
CREATE TABLE "ClassroomJoinCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdById" TEXT,
    "expiresAt" DATETIME,
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClassroomJoinCode_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassroomJoinCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ClassroomJoinCode_classroomId_key" ON "ClassroomJoinCode"("classroomId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassroomJoinCode_code_key" ON "ClassroomJoinCode"("code");

-- CreateIndex
CREATE INDEX "ClassroomJoinCode_createdById_idx" ON "ClassroomJoinCode"("createdById");

