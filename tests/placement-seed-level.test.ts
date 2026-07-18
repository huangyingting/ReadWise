import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPlacementSeedLevel,
  PLACEMENT_SEED_LEVELS,
  seedLevelForProfile,
} from "@/lib/learning/placement";

test("seedLevelForProfile maps profile levels onto Placement seed bands", () => {
  assert.equal(seedLevelForProfile("A1"), "A2");
  assert.equal(seedLevelForProfile("A2"), "A2");
  assert.equal(seedLevelForProfile("B1"), "B1");
  assert.equal(seedLevelForProfile("B2"), "B2");
  assert.equal(seedLevelForProfile("C1"), "B2");
  assert.equal(seedLevelForProfile("C2"), "B2");
});

test("seedLevelForProfile defaults unknown or absent levels to A2", () => {
  assert.equal(seedLevelForProfile(null), "A2");
  assert.equal(seedLevelForProfile(undefined), "A2");
  assert.equal(seedLevelForProfile("not-a-level"), "A2");
});

test("isPlacementSeedLevel accepts only the controlled seed set", () => {
  for (const level of PLACEMENT_SEED_LEVELS) {
    assert.equal(isPlacementSeedLevel(level), true);
  }
  assert.equal(isPlacementSeedLevel("A1"), false);
  assert.equal(isPlacementSeedLevel("C1"), false);
  assert.equal(isPlacementSeedLevel(123), false);
  assert.equal(isPlacementSeedLevel(null), false);
});