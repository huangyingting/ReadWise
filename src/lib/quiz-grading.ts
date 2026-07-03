/**
 * Server-side quiz grading (data-integrity fix, #237).
 *
 * Pure, dependency-free logic so it can be unit-tested without the AI/prisma
 * import chain that `@/lib/quiz` pulls in. The client submits ONLY its selected
 * option indices — never a self-reported score — and the server derives the
 * authoritative `correctCount` from the cached `QuizQuestion.correctIndex`
 * values, so a forged count cannot inflate mastery/leveling.
 */
import type { QuizQuestion } from "@/lib/quiz";

/** A single client-submitted answer: which question (by 0-based index) and the chosen option. */
export type SubmittedAnswer = {
  index: number;
  selectedIndex: number;
};

type QuizGradeResult = {
  correctCount: number;
  total: number;
};

function assertAnswerCount(questions: QuizQuestion[], answers: SubmittedAnswer[]): void {
  if (questions.length === 0) {
    throw new Error("No quiz questions to grade");
  }
  if (answers.length !== questions.length) {
    throw new Error("Submitted answers do not match the quiz");
  }
}

function assertKnownQuestionIndex(index: number, totalQuestions: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= totalQuestions) {
    throw new Error("Unknown question index");
  }
}

function assertUniqueQuestionIndex(index: number, seen: Set<number>): void {
  if (seen.has(index)) {
    throw new Error("Duplicate answer for a question");
  }
  seen.add(index);
}

/**
 * Grades a set of client-submitted answers against the canonical cached quiz
 * questions for an article (the source of truth for `correctIndex`).
 *
 * Throws a plain `Error` (mapped to a 400 by the route) when the submission does
 * not line up with the cached quiz: empty quiz, wrong number of answers, an
 * out-of-range question index, or a duplicate answer for the same question.
 */
export function gradeQuizAnswers(
  questions: QuizQuestion[],
  answers: SubmittedAnswer[],
): QuizGradeResult {
  assertAnswerCount(questions, answers);

  const seen = new Set<number>();
  let correctCount = 0;
  for (const answer of answers) {
    assertKnownQuestionIndex(answer.index, questions.length);
    assertUniqueQuestionIndex(answer.index, seen);

    if (answer.selectedIndex === questions[answer.index].correctIndex) {
      correctCount += 1;
    }
  }

  return { correctCount, total: questions.length };
}
