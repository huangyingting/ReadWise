process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

type EvidenceCall = {
  userId: string;
  skill: string;
  outcome: number;
  weight: number | undefined;
};

let calls: EvidenceCall[] = [];
let failingSkill: string | null = null;

before(() => {
  mock.module("@/lib/learning/skill-mastery", {
    namedExports: {
      recordSkillEvidence: async (
        userId: string,
        skill: string,
        outcome: number,
        weight?: number,
      ) => {
        calls.push({ userId, skill, outcome, weight });
        if (skill === failingSkill) throw new Error("mastery unavailable");
        return null;
      },
    },
  });
});

beforeEach(() => {
  calls = [];
  failingSkill = null;
});

async function record(activity: Parameters<
  typeof import("@/lib/learning/learner-evidence").recordLearnerEvidence
>[1]) {
  const { recordLearnerEvidence } = await import("@/lib/learning/learner-evidence");
  await recordLearnerEvidence("u1", activity);
}

test("maps each learner activity to the existing Skill Mastery policy", async () => {
  await record({ activity: "reading-progress", percent: 80 });
  await record({ activity: "quiz-completed", scorePct: 70 });
  await record({
    activity: "pronunciation-attempt",
    pronunciationScore: 85,
    accuracyScore: 75,
  });
  await record({ activity: "grammar-help-used" });
  await record({ activity: "flashcard-reviewed", grade: "hard" });
  await record({
    activity: "today-comprehension",
    selfRating: "confused",
    mcqCorrect: false,
    skillTag: "vocabulary_in_context",
  });

  assert.deepEqual(calls, [
    { userId: "u1", skill: "reading", outcome: 0.8, weight: 0.5 },
    { userId: "u1", skill: "comprehension", outcome: 0.7, weight: undefined },
    { userId: "u1", skill: "reading", outcome: 0.7, weight: 0.5 },
    { userId: "u1", skill: "pronunciation", outcome: 0.85, weight: undefined },
    { userId: "u1", skill: "listening", outcome: 0.75, weight: 0.5 },
    { userId: "u1", skill: "grammar", outcome: 0.5, weight: 0.3 },
    { userId: "u1", skill: "vocabulary", outcome: 0.35, weight: undefined },
    { userId: "u1", skill: "comprehension", outcome: 0.3, weight: 0.5 },
    { userId: "u1", skill: "vocabulary", outcome: 0, weight: undefined },
  ]);
});

test("omits optional Today MCQ evidence when no answer was graded", async () => {
  await record({
    activity: "today-comprehension",
    selfRating: "partial",
    mcqCorrect: null,
    skillTag: null,
  });

  assert.deepEqual(calls, [
    { userId: "u1", skill: "comprehension", outcome: 0.6, weight: 0.5 },
  ]);
});

test("attempts independent signals and resolves when one mastery write fails", async () => {
  failingSkill = "comprehension";

  await assert.doesNotReject(() =>
    record({ activity: "quiz-completed", scorePct: 90 }),
  );
  assert.deepEqual(calls.map((call) => call.skill).sort(), ["comprehension", "reading"]);
});