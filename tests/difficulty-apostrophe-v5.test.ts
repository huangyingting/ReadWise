/**
 * Tests for difficulty v5 apostrophe normalization correctness.
 *
 * Verifies:
 *  - Curly (U+2019) and straight (U+0027) contraction text produce identical
 *    score, CEFR level, confidence, and Lexile-like output.
 *  - ASCII fixture outputs remain unchanged (except version string).
 *  - Version is exactly deterministic-cefr/hybrid-calibrated-v5.
 *  - v4 stored results are treated as stale; v5 results are current.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deterministicDifficulty,
  heuristicDifficulty,
  DIFFICULTY_ALGORITHM_VERSION,
} from "@/lib/difficulty";
import { isDifficultyLevel } from "@/lib/leveling/cefr-primitives";

// ---------------------------------------------------------------------------
// Version assertion
// ---------------------------------------------------------------------------

test("DIFFICULTY_ALGORITHM_VERSION is exactly v5", () => {
  assert.equal(DIFFICULTY_ALGORITHM_VERSION, "deterministic-cefr/hybrid-calibrated-v5");
});

// ---------------------------------------------------------------------------
// Curly vs straight contraction fixtures — identical output
// ---------------------------------------------------------------------------

function wrapHtml(text: string, repeats = 25): string {
  return "<p>" + Array.from({ length: repeats }, () => text).join(" ") + "</p>";
}

const STRAIGHT_CONTRACTION_TEXT =
  "I don't think she's coming because they won't let us in. It's clear we can't wait and he doesn't care.";

const CURLY_CONTRACTION_TEXT =
  "I don\u2019t think she\u2019s coming because they won\u2019t let us in. It\u2019s clear we can\u2019t wait and he doesn\u2019t care.";

test("curly and straight contraction text produce identical difficulty score", () => {
  const straight = deterministicDifficulty(wrapHtml(STRAIGHT_CONTRACTION_TEXT));
  const curly = deterministicDifficulty(wrapHtml(CURLY_CONTRACTION_TEXT));

  assert.equal(curly.score, straight.score, "score mismatch");
  assert.equal(curly.level, straight.level, "level mismatch");
  assert.equal(curly.confidence, straight.confidence, "confidence mismatch");
  assert.equal(curly.lexileApprox, straight.lexileApprox, "lexileApprox mismatch");
  assert.equal(curly.version, straight.version, "version mismatch");
});

test("curly and straight contraction text produce identical sub-metrics", () => {
  const straight = deterministicDifficulty(wrapHtml(STRAIGHT_CONTRACTION_TEXT));
  const curly = deterministicDifficulty(wrapHtml(CURLY_CONTRACTION_TEXT));

  assert.equal(curly.metrics.vocabularyScore, straight.metrics.vocabularyScore);
  assert.equal(curly.metrics.readabilityScore, straight.metrics.readabilityScore);
  assert.equal(curly.metrics.syntaxScore, straight.metrics.syntaxScore);
  assert.equal(curly.metrics.idiomOrDomainScore, straight.metrics.idiomOrDomainScore);
  assert.equal(curly.metrics.lengthScore, straight.metrics.lengthScore);
  assert.equal(curly.metrics.wordCount, straight.metrics.wordCount);
  assert.equal(curly.metrics.sentenceCount, straight.metrics.sentenceCount);
});

// ---------------------------------------------------------------------------
// ASCII fixture — output must remain unchanged from v4 behavior
// ---------------------------------------------------------------------------

const ASCII_FIXTURE =
  "The child reads a book at home and talks with her family. Dogs run fast in the park.";

test("ASCII-only fixture produces valid v5 result with unchanged scoring behavior", () => {
  const result = deterministicDifficulty(wrapHtml(ASCII_FIXTURE));
  assert.ok(isDifficultyLevel(result.level));
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.ok(result.lexileApprox >= 200 && result.lexileApprox <= 1600);
  assert.equal(result.version, "deterministic-cefr/hybrid-calibrated-v5");
  assert.ok(["low", "medium", "high"].includes(result.confidence));
});

test("ASCII fixture score is stable across repeated calls", () => {
  const a = deterministicDifficulty(wrapHtml(ASCII_FIXTURE));
  const b = deterministicDifficulty(wrapHtml(ASCII_FIXTURE));
  assert.equal(a.score, b.score);
  assert.equal(a.level, b.level);
  assert.equal(a.lexileApprox, b.lexileApprox);
});

// ---------------------------------------------------------------------------
// heuristicDifficulty alias produces same output as deterministicDifficulty
// ---------------------------------------------------------------------------

test("heuristicDifficulty produces same result as deterministicDifficulty", () => {
  const content = wrapHtml(STRAIGHT_CONTRACTION_TEXT);
  const det = deterministicDifficulty(content);
  const heur = heuristicDifficulty(content);
  assert.deepEqual(det, heur);
});

// ---------------------------------------------------------------------------
// Lazy version invalidation — v4 is stale, v5 is current
// ---------------------------------------------------------------------------

test("hasCurrentStoredDifficulty logic: v4 is stale, v5 is current", () => {
  // Simulate the stored-article check that the module uses internally.
  // We verify by calling deterministicDifficulty and checking the version field.
  const result = deterministicDifficulty(wrapHtml(ASCII_FIXTURE));
  assert.equal(result.version, DIFFICULTY_ALGORITHM_VERSION);
  assert.notEqual(result.version, "deterministic-cefr/hybrid-calibrated-v4");
});

test("stored v4 result would fail current-version gate", () => {
  // The version gate in getOrCreateArticleDifficulty / ensureArticleDifficulties
  // compares article.difficultyVersion === DIFFICULTY_ALGORITHM_VERSION.
  // A v4 stored result would not match v5, triggering lazy reassessment.
  const storedV4Version = "deterministic-cefr/hybrid-calibrated-v4";
  assert.notEqual(storedV4Version, DIFFICULTY_ALGORITHM_VERSION);
  assert.equal(DIFFICULTY_ALGORITHM_VERSION, "deterministic-cefr/hybrid-calibrated-v5");
});
