-- CreateTable
CREATE TABLE "AssignmentAnnotation" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "authorId" TEXT,
    "quote" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "suffix" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentAnnotationResponse" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "annotationId" TEXT,
    "userId" TEXT NOT NULL,
    "quote" TEXT,
    "startOffset" INTEGER,
    "endOffset" INTEGER,
    "prefix" TEXT NOT NULL DEFAULT '',
    "suffix" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentAnnotationResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssignmentAnnotation_assignmentId_startOffset_idx" ON "AssignmentAnnotation"("assignmentId", "startOffset");

-- CreateIndex
CREATE INDEX "AssignmentAnnotationResponse_assignmentId_userId_idx" ON "AssignmentAnnotationResponse"("assignmentId", "userId");

-- CreateIndex
CREATE INDEX "AssignmentAnnotationResponse_annotationId_idx" ON "AssignmentAnnotationResponse"("annotationId");

-- CreateIndex
CREATE INDEX "AssignmentAnnotationResponse_userId_idx" ON "AssignmentAnnotationResponse"("userId");

-- AddForeignKey
ALTER TABLE "AssignmentAnnotation" ADD CONSTRAINT "AssignmentAnnotation_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentAnnotation" ADD CONSTRAINT "AssignmentAnnotation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentAnnotationResponse" ADD CONSTRAINT "AssignmentAnnotationResponse_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentAnnotationResponse" ADD CONSTRAINT "AssignmentAnnotationResponse_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "AssignmentAnnotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentAnnotationResponse" ADD CONSTRAINT "AssignmentAnnotationResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

