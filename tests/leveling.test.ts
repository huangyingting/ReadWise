import { test } from "node:test";
import assert from "node:assert/strict";
import { recommendLevelChange, type LevelingSignals } from "@/lib/leveling";

function makeSignals(overrides: Partial<LevelingSignals> = {}): LevelingSignals {
  return {
    avgQuizScore: null,
    quizAttemptCount: 0,
    completedAtLevel: 0,
    totalAtLevel: 10,
    currentLevel: "B1",
    ...overrides,
  };
}

// ── Sparse data → hold ─────────────────────────────────────────────────────

test("returns hold when no quiz data at all", () => {
  const rec = recommendLevelChange(makeSignals());
  assert.equal(rec.suggestion, "hold");
  assert.equal(rec.confidence, 0);
  assert.equal(rec.targetLevel, null);
});

test("returns hold when quiz attempts are below minimum threshold", () => {
  const rec = recommendLevelChange(
    makeSignals({ avgQuizScore: 90, quizAttemptCount: 2 }),
  );
  assert.equal(rec.suggestion, "hold");
});

// ── Level-up signals ───────────────────────────────────────────────────────

test("suggests up when avg quiz ≥ 85% with ≥ 3 attempts", () => {
  const rec = recommendLevelChange(
    makeSignals({ avgQuizScore: 88, quizAttemptCount: 5, currentLevel: "B1" }),
  );
  assert.equal(rec.suggestion, "up");
  assert.equal(rec.targetLevel, "B2");
  assert.ok(rec.confidence >= 0.6, "confidence should be ≥ 0.6");
  assert.ok(rec.rationale.includes("B2"), "rationale mentions target level");
});

test("suggests up with higher confidence when completions also high", () => {
  const rec = recommendLevelChange(
    makeSignals({
      avgQuizScore: 92,
      quizAttemptCount: 8,
      completedAtLevel: 5,
      currentLevel: "A2",
    }),
  );
  assert.equal(rec.suggestion, "up");
  assert.equal(rec.targetLevel, "B1");
});

test("does not suggest up beyond C2 (max level)", () => {
  const rec = recommendLevelChange(
    makeSignals({ avgQuizScore: 95, quizAttemptCount: 10, currentLevel: "C2" }),
  );
  // Can't go higher than C2 — hold
  assert.equal(rec.suggestion, "hold");
});

// ── Level-down signals ─────────────────────────────────────────────────────

test("suggests down when avg quiz < 50% with ≥ 3 attempts", () => {
  const rec = recommendLevelChange(
    makeSignals({ avgQuizScore: 40, quizAttemptCount: 4, currentLevel: "B2" }),
  );
  assert.equal(rec.suggestion, "down");
  assert.equal(rec.targetLevel, "B1");
  assert.ok(rec.confidence >= 0.55, "confidence should be ≥ 0.55");
  assert.ok(rec.rationale.includes("B1"), "rationale mentions target level");
});

test("does not suggest down below A1 (min level)", () => {
  const rec = recommendLevelChange(
    makeSignals({ avgQuizScore: 30, quizAttemptCount: 5, currentLevel: "A1" }),
  );
  // Can't go lower than A1 — hold
  assert.equal(rec.suggestion, "hold");
});

// ── Boundary cases ─────────────────────────────────────────────────────────

test("returns hold when score is exactly in the middle range (50–84)", () => {
  const rec = recommendLevelChange(
    makeSignals({ avgQuizScore: 70, quizAttemptCount: 5, currentLevel: "B1" }),
  );
  assert.equal(rec.suggestion, "hold");
});

test("returns hold when score is exactly at mastery threshold boundary (85)", () => {
  const rec = recommendLevelChange(
    makeSignals({ avgQuizScore: 85, quizAttemptCount: 3, currentLevel: "A1" }),
  );
  // At exactly 85 → up
  assert.equal(rec.suggestion, "up");
  assert.equal(rec.targetLevel, "A2");
});

test("returns hold when score is exactly at struggle threshold boundary (50)", () => {
  const rec = recommendLevelChange(
    makeSignals({ avgQuizScore: 50, quizAttemptCount: 3, currentLevel: "B1" }),
  );
  // At exactly 50, not strictly below → hold
  assert.equal(rec.suggestion, "hold");
});
