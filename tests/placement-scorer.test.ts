/**
 * Pure placement scorer tests (#806). No Prisma / no I/O.
 *
 * Exercises every branch of `computePlacementScore`, `placementOffset` (via the
 * scorer), `seedLevelForProfile`, and `isPlacementSeedLevel`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computePlacementScore,
  seedLevelForProfile,
  isPlacementSeedLevel,
  PLACEMENT_SEED_LEVELS,
} from "@/lib/learning/placement";

// ---------------------------------------------------------------------------
// computePlacementScore — bucketing branches
// ---------------------------------------------------------------------------

test("UP: high comprehension + low lookup rate → one above seed", () => {
  // correctRatio 1.0 (>=0.8), lookupRate 0.01 (<0.05) → +1
  assert.equal(computePlacementScore("B1", 5, 5, 2, 200), "B2");
});

test("UP clamps within window: seed B2 + up → C1 (max recommendable)", () => {
  assert.equal(computePlacementScore("B2", 5, 5, 0, 200), "C1");
});

test("HOLD: high comprehension but lookup rate not low enough → seed", () => {
  // correctRatio 1.0 (>=0.8) but lookupRate 0.07 (>=0.05, <0.1) → 0
  assert.equal(computePlacementScore("B1", 5, 5, 14, 200), "B1");
});

test("HOLD: mid comprehension, low lookup rate → seed", () => {
  // correctRatio 0.6 (>=0.6, <0.8) → up-condition false on first operand → 0
  assert.equal(computePlacementScore("B1", 3, 5, 2, 200), "B1");
});

test("DOWN: low comprehension → one below seed", () => {
  // correctRatio 0.4 (<0.6) → -1
  assert.equal(computePlacementScore("B1", 2, 5, 0, 200), "A2");
});

test("DOWN: high comprehension but high lookup rate → one below seed", () => {
  // correctRatio 1.0 (>=0.6) but lookupRate 0.15 (>=0.1) → -1 (conservative)
  assert.equal(computePlacementScore("B1", 5, 5, 30, 200), "A2");
});

test("DOWN clamps within window: seed A2 + down → A1 (min recommendable)", () => {
  assert.equal(computePlacementScore("A2", 0, 5, 50, 200), "A1");
});

// ---------------------------------------------------------------------------
// Guard branches: non-positive total / wordCount
// ---------------------------------------------------------------------------

test("total <= 0 scores as zero comprehension → down", () => {
  assert.equal(computePlacementScore("B1", 0, 0, 0, 200), "A2");
});

test("wordCount <= 0 treats lookups as no pressure (lookupRate 0)", () => {
  // Without the guard, lookups/0 would be Infinity → forced down. Guard makes
  // lookupRate 0 so a perfect score still earns UP.
  assert.equal(computePlacementScore("B1", 5, 5, 3, 0), "B2");
});

// ---------------------------------------------------------------------------
// seedLevelForProfile
// ---------------------------------------------------------------------------

test("seedLevelForProfile maps profile levels onto seed bands", () => {
  assert.equal(seedLevelForProfile("A1"), "A2");
  assert.equal(seedLevelForProfile("A2"), "A2");
  assert.equal(seedLevelForProfile("B1"), "B1");
  assert.equal(seedLevelForProfile("B2"), "B2");
  assert.equal(seedLevelForProfile("C1"), "B2");
  assert.equal(seedLevelForProfile("C2"), "B2");
});

test("seedLevelForProfile defaults unknown/empty to A2", () => {
  assert.equal(seedLevelForProfile(null), "A2");
  assert.equal(seedLevelForProfile(undefined), "A2");
  assert.equal(seedLevelForProfile("not-a-level"), "A2");
});

// ---------------------------------------------------------------------------
// isPlacementSeedLevel
// ---------------------------------------------------------------------------

test("isPlacementSeedLevel accepts only the controlled seed set", () => {
  for (const lvl of PLACEMENT_SEED_LEVELS) {
    assert.equal(isPlacementSeedLevel(lvl), true);
  }
  assert.equal(isPlacementSeedLevel("A1"), false);
  assert.equal(isPlacementSeedLevel("C1"), false);
  assert.equal(isPlacementSeedLevel(123), false);
  assert.equal(isPlacementSeedLevel(null), false);
});
