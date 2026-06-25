/**
 * Tests for src/lib/option-registries.ts (REF-084).
 *
 * Verifies that the client-safe registry exports the correct values and
 * that no server-only symbols are imported.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CEFR_LEVELS,
  ENGLISH_LEVELS,
  LEVEL_HINTS,
  AGE_RANGES,
  GENDERS,
  DAILY_GOAL_MIN,
  DAILY_GOAL_MAX,
  DAILY_GOAL_DEFAULT,
  TIER_LABELS,
  TIER_VARIANTS,
  isCefrLevel,
  isFrequencyTier,
} from "@/lib/option-registries";

// ---------------------------------------------------------------------------
// CEFR levels
// ---------------------------------------------------------------------------

test("CEFR_LEVELS contains 6 levels in ascending order", () => {
  assert.deepEqual([...CEFR_LEVELS], ["A1", "A2", "B1", "B2", "C1", "C2"]);
});

test("ENGLISH_LEVELS is the same reference as CEFR_LEVELS", () => {
  assert.strictEqual(ENGLISH_LEVELS, CEFR_LEVELS);
});

test("LEVEL_HINTS covers all CEFR levels", () => {
  for (const lvl of CEFR_LEVELS) {
    assert.ok(typeof LEVEL_HINTS[lvl] === "string" && LEVEL_HINTS[lvl].length > 0,
      `LEVEL_HINTS missing entry for ${lvl}`);
  }
});

test("LEVEL_HINTS preserves original labels exactly", () => {
  assert.equal(LEVEL_HINTS["A1"], "A1 · Beginner");
  assert.equal(LEVEL_HINTS["B1"], "B1 · Intermediate");
  assert.equal(LEVEL_HINTS["C2"], "C2 · Proficient");
});

test("isCefrLevel: valid levels return true", () => {
  for (const lvl of CEFR_LEVELS) {
    assert.ok(isCefrLevel(lvl));
  }
});

test("isCefrLevel: invalid values return false", () => {
  assert.equal(isCefrLevel("ZZ"), false);
  assert.equal(isCefrLevel(null), false);
  assert.equal(isCefrLevel(42), false);
});

// ---------------------------------------------------------------------------
// Profile option registries
// ---------------------------------------------------------------------------

test("AGE_RANGES has expected entries", () => {
  assert.ok(AGE_RANGES.length >= 5);
  assert.ok((AGE_RANGES as readonly string[]).includes("18-24"));
  assert.ok((AGE_RANGES as readonly string[]).includes("55+"));
});

test("GENDERS has expected entries", () => {
  assert.ok((GENDERS as readonly string[]).includes("Female"));
  assert.ok((GENDERS as readonly string[]).includes("Prefer not to say"));
});

test("DAILY_GOAL constants have sensible defaults", () => {
  assert.ok(DAILY_GOAL_MIN >= 1);
  assert.ok(DAILY_GOAL_MAX >= DAILY_GOAL_MIN);
  assert.ok(DAILY_GOAL_DEFAULT >= DAILY_GOAL_MIN && DAILY_GOAL_DEFAULT <= DAILY_GOAL_MAX);
});

// ---------------------------------------------------------------------------
// Frequency tier registry
// ---------------------------------------------------------------------------

test("TIER_LABELS covers all tiers", () => {
  assert.ok(TIER_LABELS.top1k.length > 0);
  assert.ok(TIER_LABELS.top5k.length > 0);
  assert.ok(TIER_LABELS.academic.length > 0);
});

test("TIER_VARIANTS covers all tiers", () => {
  assert.ok(TIER_VARIANTS.top1k);
  assert.ok(TIER_VARIANTS.top5k);
  assert.ok(TIER_VARIANTS.academic);
});

test("isFrequencyTier: valid tiers return true", () => {
  assert.ok(isFrequencyTier("top1k"));
  assert.ok(isFrequencyTier("top5k"));
  assert.ok(isFrequencyTier("academic"));
});

test("isFrequencyTier: invalid values return false", () => {
  assert.equal(isFrequencyTier("common"), false);
  assert.equal(isFrequencyTier(null), false);
  assert.equal(isFrequencyTier(undefined), false);
});
