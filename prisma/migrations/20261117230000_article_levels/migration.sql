-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN "lockedLevelKey" TEXT;

-- AlterTable
ALTER TABLE "AssignmentCompletion" ADD COLUMN "levelKeyRead" TEXT;

-- CreateTable
CREATE TABLE "ArticleLevel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "levelKey" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "lexileApprox" INTEGER,
    "cefrLevel" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArticleLevel_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_QuizQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "skillTag" TEXT NOT NULL DEFAULT 'textual_evidence',
    "standardCode" TEXT,
    "explanation" TEXT,
    "levelKey" TEXT NOT NULL DEFAULT 'original',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuizQuestion_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_QuizQuestion" ("articleId", "correctIndex", "createdAt", "explanation", "id", "options", "question", "skillTag", "standardCode", "updatedAt") SELECT "articleId", "correctIndex", "createdAt", "explanation", "id", "options", "question", "skillTag", "standardCode", "updatedAt" FROM "QuizQuestion";
DROP TABLE "QuizQuestion";
ALTER TABLE "new_QuizQuestion" RENAME TO "QuizQuestion";
CREATE INDEX "QuizQuestion_articleId_levelKey_idx" ON "QuizQuestion"("articleId", "levelKey");
CREATE INDEX "QuizQuestion_skillTag_articleId_idx" ON "QuizQuestion"("skillTag", "articleId");
CREATE UNIQUE INDEX "QuizQuestion_articleId_levelKey_question_key" ON "QuizQuestion"("articleId", "levelKey", "question");
CREATE TABLE "new_Highlight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "suffix" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "color" TEXT,
    "levelKey" TEXT NOT NULL DEFAULT 'original',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Highlight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Highlight_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Highlight" ("articleId", "color", "createdAt", "endOffset", "id", "note", "prefix", "quote", "startOffset", "suffix", "updatedAt", "userId") SELECT "articleId", "color", "createdAt", "endOffset", "id", "note", "prefix", "quote", "startOffset", "suffix", "updatedAt", "userId" FROM "Highlight";
DROP TABLE "Highlight";
ALTER TABLE "new_Highlight" RENAME TO "Highlight";
CREATE INDEX "Highlight_userId_articleId_idx" ON "Highlight"("userId", "articleId");
CREATE INDEX "Highlight_user_created_idx" ON "Highlight"("userId", "createdAt");
CREATE UNIQUE INDEX "Highlight_userId_articleId_levelKey_startOffset_endOffset_key" ON "Highlight"("userId", "articleId", "levelKey", "startOffset", "endOffset");
CREATE TABLE "new_QuizAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "correctCount" INTEGER NOT NULL,
    "totalQuestions" INTEGER NOT NULL,
    "scorePct" INTEGER NOT NULL,
    "clientMutationId" TEXT,
    "levelKey" TEXT NOT NULL DEFAULT 'original',
    "completedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuizAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuizAttempt_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_QuizAttempt" ("articleId", "clientMutationId", "completedAt", "correctCount", "id", "scorePct", "totalQuestions", "userId") SELECT "articleId", "clientMutationId", "completedAt", "correctCount", "id", "scorePct", "totalQuestions", "userId" FROM "QuizAttempt";
DROP TABLE "QuizAttempt";
ALTER TABLE "new_QuizAttempt" RENAME TO "QuizAttempt";
CREATE UNIQUE INDEX "QuizAttempt_clientMutationId_key" ON "QuizAttempt"("clientMutationId");
CREATE INDEX "QuizAttempt_userId_articleId_idx" ON "QuizAttempt"("userId", "articleId");
CREATE INDEX "QuizAttempt_userId_completedAt_idx" ON "QuizAttempt"("userId", "completedAt");
CREATE TABLE "new_AssignmentAnnotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assignmentId" TEXT NOT NULL,
    "authorId" TEXT,
    "quote" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "suffix" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL,
    "levelKey" TEXT NOT NULL DEFAULT 'original',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssignmentAnnotation_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssignmentAnnotation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AssignmentAnnotation" ("assignmentId", "authorId", "createdAt", "endOffset", "id", "prefix", "prompt", "quote", "startOffset", "suffix", "updatedAt") SELECT "assignmentId", "authorId", "createdAt", "endOffset", "id", "prefix", "prompt", "quote", "startOffset", "suffix", "updatedAt" FROM "AssignmentAnnotation";
DROP TABLE "AssignmentAnnotation";
ALTER TABLE "new_AssignmentAnnotation" RENAME TO "AssignmentAnnotation";
CREATE INDEX "AssignmentAnnotation_assignmentId_startOffset_idx" ON "AssignmentAnnotation"("assignmentId", "startOffset");
CREATE TABLE "new_AssignmentAnnotationResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assignmentId" TEXT NOT NULL,
    "annotationId" TEXT,
    "userId" TEXT NOT NULL,
    "quote" TEXT,
    "startOffset" INTEGER,
    "endOffset" INTEGER,
    "prefix" TEXT NOT NULL DEFAULT '',
    "suffix" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "levelKey" TEXT NOT NULL DEFAULT 'original',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssignmentAnnotationResponse_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssignmentAnnotationResponse_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "AssignmentAnnotation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssignmentAnnotationResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AssignmentAnnotationResponse" ("annotationId", "assignmentId", "body", "createdAt", "endOffset", "id", "prefix", "quote", "startOffset", "suffix", "updatedAt", "userId") SELECT "annotationId", "assignmentId", "body", "createdAt", "endOffset", "id", "prefix", "quote", "startOffset", "suffix", "updatedAt", "userId" FROM "AssignmentAnnotationResponse";
DROP TABLE "AssignmentAnnotationResponse";
ALTER TABLE "new_AssignmentAnnotationResponse" RENAME TO "AssignmentAnnotationResponse";
CREATE INDEX "AssignmentAnnotationResponse_assignmentId_userId_idx" ON "AssignmentAnnotationResponse"("assignmentId", "userId");
CREATE INDEX "AssignmentAnnotationResponse_annotationId_idx" ON "AssignmentAnnotationResponse"("annotationId");
CREATE INDEX "AssignmentAnnotationResponse_userId_idx" ON "AssignmentAnnotationResponse"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ArticleLevel_articleId_levelKey_language_key" ON "ArticleLevel"("articleId", "levelKey", "language");

