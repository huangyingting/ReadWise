/**
 * Tests for server-side quiz grading (#237).
 *
 * `gradeQuizAnswers` is pure (no prisma/AI), so these tests import it directly
 * with no mocks. It is the trust boundary that makes a forged client-reported
 * score impossible: the score is always derived from the cached correctIndex.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { gradeQuizAnswers } from "@/lib/quiz-grading";
import type { QuizQuestion } from "@/lib/quiz";

const QUESTIONS: QuizQuestion[] = [
  { question: "Q1", options: ["a", "b", "c"], correctIndex: 1 },
  { question: "Q2", options: ["a", "b", "c"], correctIndex: 0 },
  { question: "Q3", options: ["a", "b", "c"], correctIndex: 2 },
];

test("all-correct answers → full score", () => {
  const { correctCount, total } = gradeQuizAnswers(QUESTIONS, [
    { index: 0, selectedIndex: 1 },
    { index: 1, selectedIndex: 0 },
    { index: 2, selectedIndex: 2 },
  ]);
  assert.equal(correctCount, 3);
  assert.equal(total, 3);
});

test("all-wrong answers → zero (a forged count cannot inflate this)", () => {
  const { correctCount, total } = gradeQuizAnswers(QUESTIONS, [
    { index: 0, selectedIndex: 0 },
    { index: 1, selectedIndex: 1 },
    { index: 2, selectedIndex: 0 },
  ]);
  assert.equal(correctCount, 0);
  assert.equal(total, 3);
});

test("partial answers graded against the real correctIndex", () => {
  const { correctCount } = gradeQuizAnswers(QUESTIONS, [
    { index: 0, selectedIndex: 1 }, // correct
    { index: 1, selectedIndex: 2 }, // wrong
    { index: 2, selectedIndex: 2 }, // correct
  ]);
  assert.equal(correctCount, 2);
});

test("answer order does not matter (matched by index)", () => {
  const { correctCount } = gradeQuizAnswers(QUESTIONS, [
    { index: 2, selectedIndex: 2 },
    { index: 0, selectedIndex: 1 },
    { index: 1, selectedIndex: 0 },
  ]);
  assert.equal(correctCount, 3);
});

test("throws when answer count does not match the quiz length", () => {
  assert.throws(
    () => gradeQuizAnswers(QUESTIONS, [{ index: 0, selectedIndex: 1 }]),
    /do not match/,
  );
});

test("throws on an out-of-range question index", () => {
  assert.throws(
    () =>
      gradeQuizAnswers(QUESTIONS, [
        { index: 0, selectedIndex: 1 },
        { index: 1, selectedIndex: 0 },
        { index: 9, selectedIndex: 2 },
      ]),
    /Unknown question index/,
  );
});

test("throws on a duplicate question index", () => {
  assert.throws(
    () =>
      gradeQuizAnswers(QUESTIONS, [
        { index: 0, selectedIndex: 1 },
        { index: 0, selectedIndex: 1 },
        { index: 0, selectedIndex: 1 },
      ]),
    /Duplicate answer/,
  );
});

test("throws on an empty quiz", () => {
  assert.throws(() => gradeQuizAnswers([], []), /No quiz questions/);
});
