-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "textSetId" TEXT;

-- CreateTable
CREATE TABLE "TextSet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT,
    "title" TEXT NOT NULL,
    "essentialQuestion" TEXT,
    "description" TEXT,
    "educatorNotes" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TextSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TextSetItem" (
    "id" TEXT NOT NULL,
    "textSetId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "guidingNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TextSetItem_pkey" PRIMARY KEY ("id")
);

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

-- CreateIndex
CREATE INDEX "Assignment_classroomId_textSetId_idx" ON "Assignment"("classroomId", "textSetId");

-- AddForeignKey
ALTER TABLE "TextSet" ADD CONSTRAINT "TextSet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextSet" ADD CONSTRAINT "TextSet_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextSetItem" ADD CONSTRAINT "TextSetItem_textSetId_fkey" FOREIGN KEY ("textSetId") REFERENCES "TextSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextSetItem" ADD CONSTRAINT "TextSetItem_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_textSetId_fkey" FOREIGN KEY ("textSetId") REFERENCES "TextSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

