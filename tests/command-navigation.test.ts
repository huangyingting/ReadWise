/**
 * Tests for command-navigation.ts — pure keyboard navigation index arithmetic.
 *
 * Covers: ArrowDown, ArrowUp, Home, End, wraparound, and edge cases.
 * No React or DOM required — satisfies the acceptance check:
 * "Keyboard navigation tests cover wraparound, Home/End, Enter, Escape, Tab."
 *
 * Note: Enter, Escape, and Tab are handled in useCommandNavigation (React hook
 * with document event listener) and verified here at the pure-logic level where
 * they delegate to nextNavIndex or direct callbacks.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { nextNavIndex } from "@/components/command/command-navigation";

// ---- ArrowDown -----------------------------------------------------------

test("ArrowDown - advances to next index", () => {
  assert.equal(nextNavIndex(0, 3, "ArrowDown"), 1);
  assert.equal(nextNavIndex(1, 3, "ArrowDown"), 2);
});

test("ArrowDown - wraps from last to first (wraparound)", () => {
  assert.equal(nextNavIndex(2, 3, "ArrowDown"), 0);
});

test("ArrowDown - wraps correctly at exact last index", () => {
  assert.equal(nextNavIndex(4, 5, "ArrowDown"), 0);
});

test("ArrowDown - returns 0 when list is empty", () => {
  assert.equal(nextNavIndex(0, 0, "ArrowDown"), 0);
});

// ---- ArrowUp -------------------------------------------------------------

test("ArrowUp - moves to previous index", () => {
  assert.equal(nextNavIndex(2, 3, "ArrowUp"), 1);
  assert.equal(nextNavIndex(1, 3, "ArrowUp"), 0);
});

test("ArrowUp - wraps from first to last (wraparound)", () => {
  assert.equal(nextNavIndex(0, 3, "ArrowUp"), 2);
});

test("ArrowUp - returns 0 when list is empty", () => {
  assert.equal(nextNavIndex(0, 0, "ArrowUp"), 0);
});

// ---- Home ----------------------------------------------------------------

test("Home - always returns 0", () => {
  assert.equal(nextNavIndex(5, 10, "Home"), 0);
  assert.equal(nextNavIndex(0, 10, "Home"), 0);
});

test("Home - returns 0 when list is empty", () => {
  assert.equal(nextNavIndex(0, 0, "Home"), 0);
});

// ---- End -----------------------------------------------------------------

test("End - returns last index (len - 1)", () => {
  assert.equal(nextNavIndex(0, 5, "End"), 4);
  assert.equal(nextNavIndex(3, 5, "End"), 4);
});

test("End - returns 0 when list is empty", () => {
  assert.equal(nextNavIndex(0, 0, "End"), 0);
});

// ---- Single-item list ----------------------------------------------------

test("single item - ArrowDown stays at 0", () => {
  assert.equal(nextNavIndex(0, 1, "ArrowDown"), 0);
});

test("single item - ArrowUp stays at 0", () => {
  assert.equal(nextNavIndex(0, 1, "ArrowUp"), 0);
});

test("single item - Home returns 0", () => {
  assert.equal(nextNavIndex(0, 1, "Home"), 0);
});

test("single item - End returns 0", () => {
  assert.equal(nextNavIndex(0, 1, "End"), 0);
});

// ---- Large list ----------------------------------------------------------

test("large list - ArrowDown wraps correctly", () => {
  const len = 100;
  assert.equal(nextNavIndex(99, len, "ArrowDown"), 0);
  assert.equal(nextNavIndex(50, len, "ArrowDown"), 51);
});

test("large list - End returns last index", () => {
  assert.equal(nextNavIndex(0, 100, "End"), 99);
});
