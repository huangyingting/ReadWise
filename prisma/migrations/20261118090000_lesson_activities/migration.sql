-- CreateTable
CREATE TABLE "ArticleLessonScaffold" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "keyTerms" JSONB NOT NULL DEFAULT '[]',
    "promptVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArticleLessonScaffold_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssignmentPoll" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assignmentId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssignmentPoll_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssignmentPollVote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "optionIndex" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssignmentPollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "AssignmentPoll" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssignmentPollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssignmentCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assignmentId" TEXT NOT NULL,
    "afterBlock" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "explanation" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssignmentCheck_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssignmentCheckAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "checkId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "selectedIndex" INTEGER NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssignmentCheckAnswer_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "AssignmentCheck" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssignmentCheckAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ArticleLessonScaffold_articleId_key" ON "ArticleLessonScaffold"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentPoll_assignmentId_key" ON "AssignmentPoll"("assignmentId");

-- CreateIndex
CREATE INDEX "AssignmentPollVote_userId_idx" ON "AssignmentPollVote"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentPollVote_pollId_userId_key" ON "AssignmentPollVote"("pollId", "userId");

-- CreateIndex
CREATE INDEX "AssignmentCheck_assignmentId_afterBlock_idx" ON "AssignmentCheck"("assignmentId", "afterBlock");

-- CreateIndex
CREATE INDEX "AssignmentCheckAnswer_userId_idx" ON "AssignmentCheckAnswer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentCheckAnswer_checkId_userId_key" ON "AssignmentCheckAnswer"("checkId", "userId");

