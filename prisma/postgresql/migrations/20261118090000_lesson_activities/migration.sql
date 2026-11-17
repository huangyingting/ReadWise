-- CreateTable
CREATE TABLE "ArticleLessonScaffold" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "keyTerms" JSONB NOT NULL DEFAULT '[]',
    "promptVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleLessonScaffold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentPoll" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentPoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentPollVote" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "optionIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentPollVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentCheck" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "afterBlock" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "explanation" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentCheckAnswer" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "selectedIndex" INTEGER NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentCheckAnswer_pkey" PRIMARY KEY ("id")
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

-- AddForeignKey
ALTER TABLE "ArticleLessonScaffold" ADD CONSTRAINT "ArticleLessonScaffold_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentPoll" ADD CONSTRAINT "AssignmentPoll_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentPollVote" ADD CONSTRAINT "AssignmentPollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "AssignmentPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentPollVote" ADD CONSTRAINT "AssignmentPollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentCheck" ADD CONSTRAINT "AssignmentCheck_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentCheckAnswer" ADD CONSTRAINT "AssignmentCheckAnswer_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "AssignmentCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentCheckAnswer" ADD CONSTRAINT "AssignmentCheckAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

