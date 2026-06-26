/**
 * Tests for the computeRovingIndex / useRovingTabindex utilities (REF-057).
 *
 * Pure keyboard-navigation algorithm — no mocks, no DOM.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { computeRovingIndex, useRovingTabindex } from "@/lib/use-roving-tabindex";

// ---------------------------------------------------------------------------
// computeRovingIndex — SegmentedControl keyboard navigation
// ---------------------------------------------------------------------------

describe("computeRovingIndex — SegmentedControl horizontal navigation", () => {
  const N = 4;

  // ---- ArrowRight / ArrowLeft (horizontal, default) ----------------------

  test("ArrowRight advances to next segment", () => {
    assert.equal(computeRovingIndex("ArrowRight", 0, N), 1);
    assert.equal(computeRovingIndex("ArrowRight", 2, N), 3);
  });

  test("ArrowRight wraps from last segment to first", () => {
    assert.equal(computeRovingIndex("ArrowRight", N - 1, N), 0);
  });

  test("ArrowLeft retreats to previous segment", () => {
    assert.equal(computeRovingIndex("ArrowLeft", 1, N), 0);
    assert.equal(computeRovingIndex("ArrowLeft", 3, N), 2);
  });

  test("ArrowLeft wraps from first segment to last", () => {
    assert.equal(computeRovingIndex("ArrowLeft", 0, N), N - 1);
  });

  // ---- ArrowDown / ArrowUp only when vertical=true -----------------------

  test("ArrowDown returns null with default (vertical=false)", () => {
    assert.equal(computeRovingIndex("ArrowDown", 0, N), null);
  });

  test("ArrowUp returns null with default (vertical=false)", () => {
    assert.equal(computeRovingIndex("ArrowUp", 0, N), null);
  });

  test("ArrowDown advances when vertical=true (SegmentedControl with both axes)", () => {
    assert.equal(computeRovingIndex("ArrowDown", 1, N, { vertical: true }), 2);
  });

  test("ArrowDown wraps with vertical=true", () => {
    assert.equal(computeRovingIndex("ArrowDown", N - 1, N, { vertical: true }), 0);
  });

  test("ArrowUp retreats when vertical=true", () => {
    assert.equal(computeRovingIndex("ArrowUp", 2, N, { vertical: true }), 1);
  });

  test("ArrowUp wraps with vertical=true", () => {
    assert.equal(computeRovingIndex("ArrowUp", 0, N, { vertical: true }), N - 1);
  });

  // ---- Home / End (homeEnd=true) -----------------------------------------

  test("Home jumps to first segment when homeEnd=true", () => {
    assert.equal(computeRovingIndex("Home", 3, N, { homeEnd: true }), 0);
  });

  test("Home on first segment stays at 0 (idempotent)", () => {
    assert.equal(computeRovingIndex("Home", 0, N, { homeEnd: true }), 0);
  });

  test("End jumps to last segment when homeEnd=true", () => {
    assert.equal(computeRovingIndex("End", 0, N, { homeEnd: true }), N - 1);
  });

  test("End on last segment stays at last index (idempotent)", () => {
    assert.equal(computeRovingIndex("End", N - 1, N, { homeEnd: true }), N - 1);
  });

  test("Home returns null when homeEnd=false (default)", () => {
    assert.equal(computeRovingIndex("Home", 2, N), null);
  });

  test("End returns null when homeEnd=false (default)", () => {
    assert.equal(computeRovingIndex("End", 2, N), null);
  });

  // ---- Unrelated keys ----------------------------------------------------

  test("Space returns null (not a navigation key)", () => {
    assert.equal(computeRovingIndex(" ", 1, N), null);
  });

  test("Enter returns null", () => {
    assert.equal(computeRovingIndex("Enter", 1, N), null);
  });

  test("Escape returns null", () => {
    assert.equal(computeRovingIndex("Escape", 1, N), null);
  });

  test("Tab returns null", () => {
    assert.equal(computeRovingIndex("Tab", 1, N), null);
  });

  // ---- Edge cases --------------------------------------------------------

  test("returns null for an empty list (total = 0)", () => {
    assert.equal(computeRovingIndex("ArrowRight", 0, 0), null);
  });

  test("single item: ArrowRight wraps to index 0 (self)", () => {
    assert.equal(computeRovingIndex("ArrowRight", 0, 1), 0);
  });

  test("single item: ArrowLeft wraps to index 0 (self)", () => {
    assert.equal(computeRovingIndex("ArrowLeft", 0, 1), 0);
  });
});
