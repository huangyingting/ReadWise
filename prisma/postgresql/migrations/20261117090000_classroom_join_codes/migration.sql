-- CreateTable
CREATE TABLE "ClassroomJoinCode" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassroomJoinCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClassroomJoinCode_classroomId_key" ON "ClassroomJoinCode"("classroomId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassroomJoinCode_code_key" ON "ClassroomJoinCode"("code");

-- CreateIndex
CREATE INDEX "ClassroomJoinCode_createdById_idx" ON "ClassroomJoinCode"("createdById");

-- AddForeignKey
ALTER TABLE "ClassroomJoinCode" ADD CONSTRAINT "ClassroomJoinCode_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassroomJoinCode" ADD CONSTRAINT "ClassroomJoinCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

