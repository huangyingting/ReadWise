/**
 * Tests for the RW-040 evidence-based adaptive leveling layer in
 * `@/lib/leveling` (the pure {@link computeAdaptiveLevel} + the DB-backed
 * {@link getAdaptiveLevelRecommendation}). The quiz/completion-only
 * {@link recommendLevelChange} is covered by `leveling.test.ts`.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { LevelEvidence } from "@/lib/leveling";

let profileRow: Record<string, unknown> | null = null;
let feedbackRows: Array<{ vote: string; _count: { _all: number } }> = [];
let quizRows: Array<{ scorePct: number }> = [];
let completedAtLevelCount = 0;
let skillRows: Array<{ skill: string; confidence: number; evidenceCount: number }> = [];

before(() => {
  mock.module("@/lib/ai", {
    namedExports: {
      isAiConfigured: () => false,
      aiModelName: () => null,
      chatComplete: async () => null,
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        profile: { findUnique: async () => profileRow },
        articleDifficultyFeedback: { groupBy: async () => feedbackRows },
        quizAttempt: { findMany: async () => quizRows },
        readingProgress: { count: async () => completedAtLevelCount },
        skillMastery: { findMany: async () => skillRows },
      },
    },
  });
});

beforeEach(() => {
  profileRow = null;
  feedbackRows = [];
  quizRows = [];
  completedAtLevelCount = 0;
  skillRows = [];
});

function evidence(partial: Partial<LevelEvidence> = {}): LevelEvidence {
  return {
    currentLevel: "B1",
    feedback: { too_easy: 0, just_right: 0, too_hard: 0 },
    avgQuizScore: null,
    quizAttemptCount: 0,
    completedAtLevel: 0,
    skillConfidence: null,
    skillEvidenceCount: 0,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// difficultyBiasFromFeedback (pure)
// ---------------------------------------------------------------------------

test("difficultyBiasFromFeedback: too_hard pushes negative, too_easy positive, none zero", async () => {
  const { difficultyBiasFromFeedback } = await import("@/lib/leveling");
  assert.equal(difficultyBiasFromFeedback({ too_easy: 0, just_right: 0, too_hard: 0 }), 0);
  assert.ok(difficultyBiasFromFeedback({ too_easy: 0, just_right: 1, too_hard: 4 }) < 0);
  assert.ok(difficultyBiasFromFeedback({ too_easy: 4, just_right: 1, too_hard: 0 }) > 0);
});

// ---------------------------------------------------------------------------
// computeAdaptiveLevel (pure)
// ---------------------------------------------------------------------------

test("repeated too_hard feedback lowers the recommended level with an explanation", async () => {
  const { computeAdaptiveLevel } = await import("@/lib/leveling");
  const rec = computeAdaptiveLevel(
    evidence({ currentLevel: "B1", feedback: { too_easy: 0, just_right: 1, too_hard: 5 } }),
  );
  assert.equal(rec.suggestion, "down");
  assert.equal(rec.recommendedLevel, "A2");
  assert.equal(rec.targetLevel, "A2");
  assert.ok(rec.difficultyBias < 0);
  assert.ok(rec.confidence > 0);
  assert.ok(rec.explanation.some((l) => /too hard/i.test(l)));
  assert.ok(rec.explanation.some((l) => /A2/.test(l)));
});

test("strong quiz performance + high skill confidence raises the recommended level", async () => {
  const { computeAdaptiveLevel } = await import("@/lib/leveling");
  const rec = computeAdaptiveLevel(
    evidence({
      currentLevel: "B1",
      avgQuizScore: 92,
      quizAttemptCount: 6,
      skillConfidence: 0.85,
      skillEvidenceCount: 8,
    }),
  );
  assert.equal(rec.suggestion, "up");
  assert.equal(rec.recommendedLevel, "B2");
  assert.equal(rec.targetLevel, "B2");
  assert.ok(rec.confidence > 0);
  assert.ok(rec.explanation.some((l) => /B2/.test(l)));
  assert.ok(rec.explanation.some((l) => /quiz/i.test(l)));
});

test("thin evidence holds at the current level (no-op)", async () => {
  const { computeAdaptiveLevel } = await import("@/lib/leveling");
  const rec = computeAdaptiveLevel(evidence({ currentLevel: "B1" }));
  assert.equal(rec.suggestion, "hold");
  assert.equal(rec.recommendedLevel, "B1");
  assert.equal(rec.targetLevel, null);
  assert.equal(rec.confidence, 0);
  assert.ok(rec.explanation.some((l) => /not enough evidence/i.test(l)));
});

test("conflicting up/down evidence holds rather than flip-flopping", async () => {
  const { computeAdaptiveLevel } = await import("@/lib/leveling");
  // strong quiz (up) but lots of too_hard (down) → tie → hold
  const rec = computeAdaptiveLevel(
    evidence({
      currentLevel: "B1",
      avgQuizScore: 95,
      quizAttemptCount: 5,
      feedback: { too_easy: 0, just_right: 0, too_hard: 5 },
    }),
  );
  assert.equal(rec.suggestion, "hold");
  assert.equal(rec.recommendedLevel, "B1");
});

test("never recommends below the easiest or above the hardest level", async () => {
  const { computeAdaptiveLevel } = await import("@/lib/leveling");
  const down = computeAdaptiveLevel(
    evidence({ currentLevel: "A1", feedback: { too_easy: 0, just_right: 0, too_hard: 6 } }),
  );
  assert.equal(down.suggestion, "hold");
  assert.equal(down.recommendedLevel, "A1");

  const up = computeAdaptiveLevel(
    evidence({
      currentLevel: "C2",
      avgQuizScore: 98,
      quizAttemptCount: 6,
      feedback: { too_easy: 6, just_right: 0, too_hard: 0 },
    }),
  );
  assert.equal(up.suggestion, "hold");
  assert.equal(up.recommendedLevel, "C2");
});

// ---------------------------------------------------------------------------
// getAdaptiveLevelRecommendation (DB)
// ---------------------------------------------------------------------------

test("getAdaptiveLevelRecommendation returns null when the user has no profile", async () => {
  const { getAdaptiveLevelRecommendation } = await import("@/lib/leveling");
  profileRow = null;
  assert.equal(await getAdaptiveLevelRecommendation("nobody"), null);
});

test("getAdaptiveLevelRecommendation lowers level after repeated too_hard from the DB", async () => {
  const { getAdaptiveLevelRecommendation } = await import("@/lib/leveling");
  profileRow = { userId: "u1", englishLevel: "B1", topics: "[]" };
  feedbackRows = [
    { vote: "too_hard", _count: { _all: 5 } },
    { vote: "just_right", _count: { _all: 1 } },
  ];
  const rec = await getAdaptiveLevelRecommendation("u1");
  assert.ok(rec);
  assert.equal(rec!.suggestion, "down");
  assert.equal(rec!.recommendedLevel, "A2");
});

test("getAdaptiveLevelRecommendation raises level on strong DB evidence", async () => {
  const { getAdaptiveLevelRecommendation } = await import("@/lib/leveling");
  profileRow = { userId: "u1", englishLevel: "B1", topics: "[]" };
  quizRows = Array.from({ length: 6 }, () => ({ scorePct: 93 }));
  skillRows = [
    { skill: "reading", confidence: 0.85, evidenceCount: 5 },
    { skill: "vocabulary", confidence: 0.82, evidenceCount: 5 },
  ];
  const rec = await getAdaptiveLevelRecommendation("u1");
  assert.ok(rec);
  assert.equal(rec!.suggestion, "up");
  assert.equal(rec!.recommendedLevel, "B2");
});
