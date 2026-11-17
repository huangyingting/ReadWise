-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'LEVEL_ADAPT';

-- DropIndex
DROP INDEX "QuizQuestion_articleId_idx";

-- DropIndex
DROP INDEX "QuizQuestion_articleId_question_key";

-- DropIndex
DROP INDEX "Highlight_userId_articleId_startOffset_endOffset_key";

-- AlterTable
ALTER TABLE "QuizQuestion" ADD COLUMN     "levelKey" TEXT NOT NULL DEFAULT 'original';

-- AlterTable
ALTER TABLE "Highlight" ADD COLUMN     "levelKey" TEXT NOT NULL DEFAULT 'original';

-- AlterTable
ALTER TABLE "QuizAttempt" ADD COLUMN     "levelKey" TEXT NOT NULL DEFAULT 'original';

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "lockedLevelKey" TEXT;

-- AlterTable
ALTER TABLE "AssignmentAnnotation" ADD COLUMN     "levelKey" TEXT NOT NULL DEFAULT 'original';

-- AlterTable
ALTER TABLE "AssignmentAnnotationResponse" ADD COLUMN     "levelKey" TEXT NOT NULL DEFAULT 'original';

-- AlterTable
ALTER TABLE "AssignmentCompletion" ADD COLUMN     "levelKeyRead" TEXT;

-- CreateTable
CREATE TABLE "ArticleLevel" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleLevel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArticleLevel_articleId_levelKey_language_key" ON "ArticleLevel"("articleId", "levelKey", "language");

-- CreateIndex
CREATE INDEX "QuizQuestion_articleId_levelKey_idx" ON "QuizQuestion"("articleId", "levelKey");

-- CreateIndex
CREATE UNIQUE INDEX "QuizQuestion_articleId_levelKey_question_key" ON "QuizQuestion"("articleId", "levelKey", "question");

-- CreateIndex
CREATE UNIQUE INDEX "Highlight_userId_articleId_levelKey_startOffset_endOffset_key" ON "Highlight"("userId", "articleId", "levelKey", "startOffset", "endOffset");

-- AddForeignKey
ALTER TABLE "ArticleLevel" ADD CONSTRAINT "ArticleLevel_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

