/**
 * Tests for the placement quiz scoring logic in src/lib/placement.ts (#120).
 *
 * All functions under test are pure — no DB or network involved.
 * Runs on Node's built-in test runner.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  suggestLevel,
  getPlacementQuestions,
  placementLevelRank,
  computePlacementScore,
} from "@/lib/placement";
import type { EnglishLevel } from "@/lib/profile";

// ---------------------------------------------------------------------------
// suggestLevel
// ---------------------------------------------------------------------------

test("returns null when score is > 1/3 (2/3 correct)", () => {
  const result = suggestLevel(2, 3, "B1" as EnglishLevel);
  assert.equal(result, null);
});

test("returns null when score is 3/3 correct", () => {
  const result = suggestLevel(3, 3, "B2" as EnglishLevel);
  assert.equal(result, null);
});

test("returns one level lower when score is 0/3", () => {
  const result = suggestLevel(0, 3, "B1" as EnglishLevel);
  assert.equal(result, "A2");
});

test("returns one level lower when score is 1/3", () => {
  const result = suggestLevel(1, 3, "C1" as EnglishLevel);
  assert.equal(result, "B2");
});

test("returns null when already at A1 and score is 0/3", () => {
  const result = suggestLevel(0, 3, "A1" as EnglishLevel);
  assert.equal(result, null);
});

test("returns null when total is 0", () => {
  const result = suggestLevel(0, 0, "B2" as EnglishLevel);
  assert.equal(result, null);
});

test("boundary: 1/3 is exactly ≤ 1/3 → suggests lower", () => {
  // 1/3 = 0.333... which is not strictly > 1/3, so should suggest
  const result = suggestLevel(1, 3, "B2" as EnglishLevel);
  assert.equal(result, "B1");
});

test("boundary: 2/3 is > 1/3 → no suggestion", () => {
  const result = suggestLevel(2, 3, "B2" as EnglishLevel);
  assert.equal(result, null);
});

// Test all levels degrade correctly
for (const [level, expected] of [
  ["A2", "A1"],
  ["B1", "A2"],
  ["B2", "B1"],
  ["C1", "B2"],
  ["C2", "C1"],
] as [EnglishLevel, EnglishLevel][]) {
  test(`score 0/3 at ${level} suggests ${expected}`, () => {
    const result = suggestLevel(0, 3, level);
    assert.equal(result, expected);
  });
}

// ---------------------------------------------------------------------------
// placementLevelRank
// ---------------------------------------------------------------------------

test("placementLevelRank returns correct ordinals", () => {
  assert.equal(placementLevelRank("A1"), 0);
  assert.equal(placementLevelRank("A2"), 1);
  assert.equal(placementLevelRank("B1"), 2);
  assert.equal(placementLevelRank("B2"), 3);
  assert.equal(placementLevelRank("C1"), 4);
  assert.equal(placementLevelRank("C2"), 5);
});

test("placementLevelRank returns -1 for unknown level", () => {
  assert.equal(placementLevelRank("X1"), -1);
});

// ---------------------------------------------------------------------------
// getPlacementQuestions
// ---------------------------------------------------------------------------

test("getPlacementQuestions returns exactly 3 questions", () => {
  for (const level of ["A1", "A2", "B1", "B2", "C1", "C2"] as EnglishLevel[]) {
    const questions = getPlacementQuestions(level);
    assert.equal(questions.length, 3, `Expected 3 questions for ${level}`);
  }
});

test("all questions have valid correctIndex", () => {
  for (const level of ["A1", "A2", "B1", "B2", "C1", "C2"] as EnglishLevel[]) {
    const questions = getPlacementQuestions(level);
    for (const q of questions) {
      assert.ok(q.correctIndex >= 0, "correctIndex should be >= 0");
      assert.ok(
        q.correctIndex < q.options.length,
        `correctIndex ${q.correctIndex} is out of range for ${q.id}`,
      );
    }
  }
});

test("all questions have at least 2 options", () => {
  for (const level of ["A1", "A2", "B1", "B2", "C1", "C2"] as EnglishLevel[]) {
    const questions = getPlacementQuestions(level);
    for (const q of questions) {
      assert.ok(q.options.length >= 2, `Question ${q.id} should have at least 2 options`);
    }
  }
});

// ---------------------------------------------------------------------------
// computePlacementScore
// ---------------------------------------------------------------------------

test("computePlacementScore returns 0 when all answers are null", () => {
  const questions = getPlacementQuestions("B1");
  assert.equal(computePlacementScore([null, null, null], questions), 0);
});

test("computePlacementScore counts only correct answers", () => {
  const questions = getPlacementQuestions("B1");
  // All correct
  const allCorrect = questions.map((q) => q.correctIndex);
  assert.equal(computePlacementScore(allCorrect, questions), 3);
});

test("computePlacementScore counts partially correct answers", () => {
  const questions = getPlacementQuestions("B1");
  // First correct, rest wrong (use index 999 which is out of range so always wrong)
  const partial: (number | null)[] = [questions[0].correctIndex, 999, 999];
  assert.equal(computePlacementScore(partial, questions), 1);
});

test("computePlacementScore ignores null slots", () => {
  const questions = getPlacementQuestions("A2");
  const answers: (number | null)[] = [questions[0].correctIndex, null, questions[2].correctIndex];
  assert.equal(computePlacementScore(answers, questions), 2);
});

test("computePlacementScore returns 0 for empty arrays", () => {
  assert.equal(computePlacementScore([], []), 0);
});
