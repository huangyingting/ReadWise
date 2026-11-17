-- CreateEnum
CREATE TYPE "WriteSubmissionStatus" AS ENUM ('draft', 'submitted', 'needs_revision', 'graded');

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "writePrompt" TEXT;

-- CreateTable
CREATE TABLE "WritePrompt" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WritePrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WriteSubmission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "status" "WriteSubmissionStatus" NOT NULL DEFAULT 'draft',
    "body" TEXT NOT NULL DEFAULT '',
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "prompt" TEXT NOT NULL,
    "rubricScores" JSONB NOT NULL DEFAULT '{}',
    "teacherFeedback" TEXT,
    "revisionCount" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "gradedAt" TIMESTAMP(3),
    "gradedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WriteSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WritePrompt_articleId_key" ON "WritePrompt"("articleId");

-- CreateIndex
CREATE INDEX "WriteSubmission_assignmentId_status_idx" ON "WriteSubmission"("assignmentId", "status");

-- CreateIndex
CREATE INDEX "WriteSubmission_userId_updatedAt_idx" ON "WriteSubmission"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WriteSubmission_userId_articleId_scopeKey_key" ON "WriteSubmission"("userId", "articleId", "scopeKey");

-- AddForeignKey
ALTER TABLE "WritePrompt" ADD CONSTRAINT "WritePrompt_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WriteSubmission" ADD CONSTRAINT "WriteSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WriteSubmission" ADD CONSTRAINT "WriteSubmission_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WriteSubmission" ADD CONSTRAINT "WriteSubmission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

