-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN "writePrompt" TEXT;

-- CreateTable
CREATE TABLE "WritePrompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WritePrompt_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WriteSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "body" TEXT NOT NULL DEFAULT '',
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "prompt" TEXT NOT NULL,
    "rubricScores" JSONB NOT NULL DEFAULT '{}',
    "teacherFeedback" TEXT,
    "revisionCount" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" DATETIME,
    "gradedAt" DATETIME,
    "gradedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WriteSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WriteSubmission_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WriteSubmission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WritePrompt_articleId_key" ON "WritePrompt"("articleId");

-- CreateIndex
CREATE INDEX "WriteSubmission_assignmentId_status_idx" ON "WriteSubmission"("assignmentId", "status");

-- CreateIndex
CREATE INDEX "WriteSubmission_userId_updatedAt_idx" ON "WriteSubmission"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WriteSubmission_userId_articleId_scopeKey_key" ON "WriteSubmission"("userId", "articleId", "scopeKey");

