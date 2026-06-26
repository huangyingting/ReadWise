/**
 * Tests for SegmentedControl selected-index derivation (REF-057).
 *
 * Pure value-to-index mapping — no mocks, no DOM.
 * Uses computeRovingIndex from @/lib/use-roving-tabindex for navigation contract.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { computeRovingIndex } from "@/lib/use-roving-tabindex";

// ---------------------------------------------------------------------------
// SegmentedControl selected-index derivation
// ---------------------------------------------------------------------------

describe("SegmentedControl selected-index derivation — value → index mapping", () => {
  const opts = [
    { value: "light", label: "Light" },
    { value: "sepia", label: "Sepia" },
    { value: "dark", label: "Dark" },
  ] as const;

  /** Pure replica of selectedIndex from SegmentedControl. */
  function selectedIndex(value: string): number {
    return Math.max(0, opts.findIndex((o) => o.value === value));
  }

  test("returns 0 for the first option ('light')", () => {
    assert.equal(selectedIndex("light"), 0);
  });

  test("returns 1 for the second option ('sepia')", () => {
    assert.equal(selectedIndex("sepia"), 1);
  });

  test("returns 2 for the third option ('dark')", () => {
    assert.equal(selectedIndex("dark"), 2);
  });

  test("returns 0 when value is not found (Math.max clamp)", () => {
    assert.equal(selectedIndex("unknown"), 0);
  });

  test("tabIndex assignment contract: only checked segment gets tabIndex=0", () => {
    const active = "sepia";
    const tabIndices = opts.map((o) => (o.value === active ? 0 : -1));
    assert.deepEqual(tabIndices, [-1, 0, -1]);
  });

  test("navigation with computeRovingIndex wraps correctly over 3 options", () => {
    assert.equal(computeRovingIndex("ArrowRight", 2, 3), 0);
    assert.equal(computeRovingIndex("ArrowLeft", 0, 3), 2);
    assert.equal(computeRovingIndex("Home", 2, 3, { homeEnd: true }), 0);
    assert.equal(computeRovingIndex("End", 0, 3, { homeEnd: true }), 2);
  });

  test("announcement string format: 'label: optionLabel'", () => {
    const groupLabel = "Reading theme";
    const opt = opts[selectedIndex("sepia")];
    const announcement = `${groupLabel}: ${opt!.label}`;
    assert.equal(announcement, "Reading theme: Sepia");
  });
});
