/**
 * Unit tests for Goal Paths (#809) — `src/lib/learning/goal-path.ts`.
 *
 * Covers: the `isGoalPath` validator (accept/reject), per-path
 * `applyGoalPathAdjustment` multipliers, the ±0.2 additive cap, `goalPathDelta`
 * sign behaviour, and the content-starvation guard (`resolveEffectiveGoalPath`)
 * which relaxes tuning to standard scoring when fewer than two candidates fit.
 *
 * Pure functions only — no DB, no mocks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GOAL_PATHS,
  GOAL_PATH_ADJUSTMENT_CAP,
  GOAL_PATH_MIN_CANDIDATES,
  isGoalPath,
  goalPathDelta,
  applyGoalPathAdjustment,
  goalPathCandidateFits,
  resolveEffectiveGoalPath,
  type GoalPathArticle,
} from "@/lib/learning/goal-path";

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

test("isGoalPath accepts every controlled value", () => {
  for (const path of GOAL_PATHS) {
    assert.equal(isGoalPath(path), true);
  }
});

test("isGoalPath rejects unknown / non-string values", () => {
  for (const bad of ["", "DAILY_NEWS", "casual", "news", null, undefined, 1, {}, []]) {
    assert.equal(isGoalPath(bad), false);
  }
});

// ---------------------------------------------------------------------------
// applyGoalPathAdjustment — per-path multipliers + cap
// ---------------------------------------------------------------------------

test("daily_news boosts a short current-events article", () => {
  const article: GoalPathArticle = {
    wordCount: 400,
    category: "current_events",
    difficulty: "B1",
  };
  assert.ok(goalPathDelta(article, "daily_news") > 0);
  assert.ok(applyGoalPathAdjustment(0.5, article, "daily_news") > 0.5);
});

test("business boosts a business/finance article and technology", () => {
  const biz: GoalPathArticle = { wordCount: 700, category: "business", difficulty: "B2" };
  const tech: GoalPathArticle = { wordCount: 700, category: "technology", difficulty: "B2" };
  assert.ok(goalPathDelta(biz, "business") > 0);
  assert.ok(goalPathDelta(tech, "business") > 0);
  // business gets the larger ×1.3 boost than technology's ×1.2
  assert.ok(goalPathDelta(biz, "business") > goalPathDelta(tech, "business"));
});

test("extensive penalises a long, hard article", () => {
  const article: GoalPathArticle = { wordCount: 2000, category: "science", difficulty: "C1" };
  assert.ok(goalPathDelta(article, "extensive") < 0);
  assert.ok(applyGoalPathAdjustment(0.5, article, "extensive") < 0.5);
});

test("academic tolerates a longer, harder article better than extensive", () => {
  const article: GoalPathArticle = { wordCount: 1100, difficulty: "C1" };
  // within academic's 1200-word max + B2–C1 band → non-negative
  assert.ok(goalPathDelta(article, "academic") >= 0);
  // same article is penalised under the strict extensive path
  assert.ok(goalPathDelta(article, "extensive") < 0);
});

test("adjustment never exceeds the ±0.2 additive cap", () => {
  const huge: GoalPathArticle = { wordCount: 100000, difficulty: "C2" };
  const ideal: GoalPathArticle = { wordCount: 100, category: "business", difficulty: "B1" };
  for (const path of GOAL_PATHS) {
    assert.ok(Math.abs(goalPathDelta(huge, path)) <= GOAL_PATH_ADJUSTMENT_CAP + 1e-9);
    assert.ok(Math.abs(goalPathDelta(ideal, path)) <= GOAL_PATH_ADJUSTMENT_CAP + 1e-9);
  }
});

test("applyGoalPathAdjustment clamps the result into [0,1]", () => {
  const ideal: GoalPathArticle = { wordCount: 100, category: "business", difficulty: "B1" };
  assert.equal(applyGoalPathAdjustment(0.95, ideal, "business"), 1);
  const bad: GoalPathArticle = { wordCount: 100000, difficulty: "C2" };
  assert.equal(applyGoalPathAdjustment(0.05, bad, "extensive"), 0);
});

test("empty article metadata yields a neutral (zero) delta", () => {
  for (const path of GOAL_PATHS) {
    assert.equal(goalPathDelta({}, path), 0);
  }
});

// ---------------------------------------------------------------------------
// Content-starvation guard
// ---------------------------------------------------------------------------

test("resolveEffectiveGoalPath keeps the path when >= 2 candidates fit", () => {
  const candidates: GoalPathArticle[] = [
    { wordCount: 300, category: "current_events", difficulty: "B1" },
    { wordCount: 400, category: "current_events", difficulty: "B2" },
    { wordCount: 5000, difficulty: "C2" },
  ];
  assert.equal(resolveEffectiveGoalPath(candidates, "daily_news"), "daily_news");
});

test("resolveEffectiveGoalPath relaxes to null when < 2 candidates fit", () => {
  const candidates: GoalPathArticle[] = [
    { wordCount: 300, category: "current_events", difficulty: "B1" }, // fits
    { wordCount: 9000, difficulty: "C2" }, // does not fit
    { wordCount: 8000, difficulty: "C2" }, // does not fit
  ];
  assert.equal(resolveEffectiveGoalPath(candidates, "daily_news"), null);
  assert.equal(GOAL_PATH_MIN_CANDIDATES, 2);
});

test("resolveEffectiveGoalPath passes a null path straight through", () => {
  assert.equal(resolveEffectiveGoalPath([{ wordCount: 100 }], null), null);
});

test("goalPathCandidateFits agrees with a positive delta", () => {
  const fits: GoalPathArticle = { wordCount: 300, category: "current_events", difficulty: "B1" };
  const starves: GoalPathArticle = { wordCount: 9000, difficulty: "C2" };
  assert.equal(goalPathCandidateFits(fits, "daily_news"), true);
  assert.equal(goalPathCandidateFits(starves, "daily_news"), false);
});
