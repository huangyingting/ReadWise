-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "maturityBand" TEXT NOT NULL DEFAULT 'general';

-- AlterTable
ALTER TABLE "QuizQuestion" ADD COLUMN     "explanation" TEXT,
ADD COLUMN     "skillTag" TEXT NOT NULL DEFAULT 'textual_evidence',
ADD COLUMN     "standardCode" TEXT;

-- CreateTable
CREATE TABLE "QuizAttemptAnswer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT,
    "questionIndex" INTEGER NOT NULL,
    "skillTag" TEXT NOT NULL,
    "selectedIndex" INTEGER NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizAttemptAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuizAttemptAnswer_questionId_idx" ON "QuizAttemptAnswer"("questionId");

-- CreateIndex
CREATE INDEX "QuizAttemptAnswer_skillTag_idx" ON "QuizAttemptAnswer"("skillTag");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAttemptAnswer_attemptId_questionIndex_key" ON "QuizAttemptAnswer"("attemptId", "questionIndex");

-- CreateIndex
CREATE INDEX "Article_maturityBand_idx" ON "Article"("maturityBand");

-- CreateIndex
CREATE INDEX "QuizQuestion_skillTag_articleId_idx" ON "QuizQuestion"("skillTag", "articleId");

-- AddForeignKey
ALTER TABLE "QuizAttemptAnswer" ADD CONSTRAINT "QuizAttemptAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "QuizAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttemptAnswer" ADD CONSTRAINT "QuizAttemptAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuizQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill (#1302): classify existing questions with the same ordered keyword
-- rules as classifyQuestionSkill() in src/lib/learning/reading-skills.ts, then
-- derive each question's anchor standard.
UPDATE "QuizQuestion" SET "skillTag" = CASE
  WHEN lower("question") LIKE '%closest in meaning%'
       OR lower("question") LIKE '%the word%'
       OR lower("question") LIKE '%the phrase%'
       OR lower("question") LIKE '%the term%'
       OR lower("question") LIKE '%meaning of%'
       OR lower("question") LIKE '%most likely means%'
       OR lower("question") LIKE '%mean?%'
       OR lower("question") LIKE '%means?%'
       OR lower("question") LIKE '%definition%'
    THEN 'vocabulary_in_context'
  WHEN lower("question") LIKE '%main idea%'
       OR lower("question") LIKE '%central idea%'
       OR lower("question") LIKE '%mainly about%'
       OR lower("question") LIKE '%mostly about%'
       OR lower("question") LIKE '%primarily about%'
       OR lower("question") LIKE '%main point%'
       OR lower("question") LIKE '%summary%'
       OR lower("question") LIKE '%summarize%'
       OR lower("question") LIKE '%best title%'
    THEN 'main_idea'
  WHEN lower("question") LIKE '%argue%'
       OR lower("question") LIKE '%argument%'
       OR lower("question") LIKE '%claim%'
       OR lower("question") LIKE '%convince%'
       OR lower("question") LIKE '%persuade%'
    THEN 'argument'
  WHEN lower("question") LIKE '%purpose%'
       OR lower("question") LIKE '%point of view%'
       OR lower("question") LIKE '%perspective%'
       OR lower("question") LIKE '%the tone%'
       OR lower("question") LIKE '%tone of%'
       OR lower("question") LIKE '%attitude%'
       OR lower("question") LIKE '%why did the author%'
       OR lower("question") LIKE '%why does the author%'
    THEN 'point_of_view'
  WHEN lower("question") LIKE '%why%'
       OR lower("question") LIKE '%cause%'
       OR lower("question") LIKE '%because%'
       OR lower("question") LIKE '%result%'
       OR lower("question") LIKE '%effect%'
       OR lower("question") LIKE '%lead to%'
       OR lower("question") LIKE '%led to%'
       OR lower("question") LIKE '%consequence%'
    THEN 'cause_effect'
  ELSE 'textual_evidence'
END;

UPDATE "QuizQuestion" SET "standardCode" = CASE "skillTag"
  WHEN 'textual_evidence' THEN 'CCRA.R.1'
  WHEN 'main_idea' THEN 'CCRA.R.2'
  WHEN 'cause_effect' THEN 'CCRA.R.3'
  WHEN 'vocabulary_in_context' THEN 'CCRA.R.4'
  WHEN 'point_of_view' THEN 'CCRA.R.6'
  WHEN 'argument' THEN 'CCRA.R.8'
END;
