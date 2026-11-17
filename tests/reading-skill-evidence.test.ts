/**
 * Unit tests for reading-skill evidence (#1302): graded quiz answers feed
 * vocabulary Skill Mastery and the coach-memory main_idea / inference
 * dimensions; textual-evidence answers inform neither.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

let evidence: Array<{ userId: string; activity: Record<string, unknown> }> = [];
let coach: Array<{ userId: string; skill: string; confidence: number }> = [];

before(() => {
  mock.module("@/lib/learning/learner-evidence", {
    namedExports: {
      recordLearnerEvidence: async (userId: string, activity: Record<string, unknown>) => {
        evidence.push({ userId, activity });
      },
    },
  });
  mock.module("@/lib/learning/coach-memory", {
    namedExports: {
      syncCoachMemory: async (userId: string, skill: string, confidence: number) => {
        coach.push({ userId, skill, confidence });
      },
    },
  });
});

beforeEach(() => {
  evidence = [];
  coach = [];
});

test("answers map onto vocabulary mastery and coach-memory reading dimensions", async () => {
  const { recordReadingSkillEvidence } = await import("@/lib/learning/reading-skill-evidence");
  await recordReadingSkillEvidence("u1", [
    { skillTag: "vocabulary_in_context", correct: true },
    { skillTag: "vocabulary_in_context", correct: false },
    { skillTag: "main_idea", correct: true },
    { skillTag: "cause_effect", correct: true },
    { skillTag: "argument", correct: false },
    { skillTag: "point_of_view", correct: true },
    { skillTag: "textual_evidence", correct: false },
  ]);
  assert.deepEqual(evidence, [
    { userId: "u1", activity: { activity: "quiz-vocabulary-in-context", correct: 1, total: 2 } },
  ]);
  assert.deepEqual(
    coach.sort((a, b) => a.skill.localeCompare(b.skill)),
    [
      { userId: "u1", skill: "inference", confidence: 2 / 3 },
      { userId: "u1", skill: "main_idea", confidence: 1 },
    ],
  );
});

test("detail-only quizzes record nothing", async () => {
  const { recordReadingSkillEvidence } = await import("@/lib/learning/reading-skill-evidence");
  await recordReadingSkillEvidence("u1", [{ skillTag: "textual_evidence", correct: true }]);
  await recordReadingSkillEvidence("u1", []);
  assert.deepEqual(evidence, []);
  assert.deepEqual(coach, []);
});
