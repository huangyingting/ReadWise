/**
 * Unit tests for the SM-2 SRS engine (src/lib/srs.ts).
 * Pure functions — no mocking needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applySm2 } from "@/lib/srs";

const BASE: import("@/lib/srs").SrsState = {
  intervalDays: 0,
  easeFactor: 2.5,
  repetitions: 0,
};

// ---- Again (reset) -------------------------------------------------------

test("again resets repetitions to 0 and sets interval to 1 day", () => {
  const result = applySm2({ ...BASE, repetitions: 3, intervalDays: 15 }, "again");
  assert.equal(result.repetitions, 0);
  assert.equal(result.intervalDays, 1);
});

test("again reduces easeFactor by 0.2 (floored at 1.3)", () => {
  const result = applySm2({ ...BASE, easeFactor: 1.4 }, "again");
  assert.ok(
    Math.abs(result.easeFactor - 1.3) < 0.001,
    `easeFactor should be 1.3 (got ${result.easeFactor})`,
  );
});

test("again does not reduce easeFactor below 1.3", () => {
  const result = applySm2({ ...BASE, easeFactor: 1.3 }, "again");
  assert.ok(result.easeFactor >= 1.3);
});

test("again sets dueAt to approximately 1 day from now", () => {
  const before = Date.now();
  const result = applySm2(BASE, "again");
  const after = Date.now();
  const oneDayMs = 86_400_000;
  assert.ok(result.dueAt.getTime() >= before + oneDayMs - 1000);
  assert.ok(result.dueAt.getTime() <= after + oneDayMs + 1000);
});

// ---- Good — interval progression ----------------------------------------

test("good on a fresh card: repetitions 0→1, interval=1", () => {
  const result = applySm2({ ...BASE, repetitions: 0 }, "good");
  assert.equal(result.repetitions, 1);
  assert.equal(result.intervalDays, 1);
});

test("good on second review: repetitions 1→2, interval=6", () => {
  const result = applySm2({ ...BASE, repetitions: 1, intervalDays: 1 }, "good");
  assert.equal(result.repetitions, 2);
  assert.equal(result.intervalDays, 6);
});

test("good on third review: interval = round(prevInterval * EF)", () => {
  const state = { intervalDays: 6, easeFactor: 2.5, repetitions: 2 };
  const result = applySm2(state, "good");
  assert.equal(result.repetitions, 3);
  assert.equal(result.intervalDays, Math.round(6 * 2.5)); // 15
});

test("good keeps easeFactor stable (EF change ≈ 0 for q=4)", () => {
  const result = applySm2({ ...BASE, easeFactor: 2.5 }, "good");
  // EF' = 2.5 + (0.1 - 1*(0.08+0.02)) = 2.5 + 0 = 2.5
  assert.ok(Math.abs(result.easeFactor - 2.5) < 0.001);
});

// ---- Easy ----------------------------------------------------------------

test("easy increases easeFactor", () => {
  const result = applySm2({ ...BASE, easeFactor: 2.5 }, "easy");
  // EF' = 2.5 + 0.1 = 2.6
  assert.ok(result.easeFactor > 2.5);
});

test("easy on third review gives a larger interval than good", () => {
  const state = { intervalDays: 6, easeFactor: 2.5, repetitions: 2 };
  const goodResult = applySm2(state, "good");
  const easyResult = applySm2(state, "easy");
  assert.ok(
    easyResult.intervalDays >= goodResult.intervalDays,
    `easy interval (${easyResult.intervalDays}) should be >= good (${goodResult.intervalDays})`,
  );
});

// ---- Hard ----------------------------------------------------------------

test("hard decreases easeFactor", () => {
  const result = applySm2({ ...BASE, easeFactor: 2.5 }, "hard");
  // EF' = 2.5 + (0.1 - 2*(0.08+2*0.02)) = 2.5 + (0.1 - 2*0.12) = 2.5 - 0.14 = 2.36
  assert.ok(result.easeFactor < 2.5);
});

test("hard does not drop easeFactor below 1.3", () => {
  const result = applySm2({ ...BASE, easeFactor: 1.3 }, "hard");
  assert.ok(result.easeFactor >= 1.3);
});

test("hard caps interval growth (lower than good at repetition >= 2)", () => {
  const state = { intervalDays: 6, easeFactor: 2.5, repetitions: 2 };
  const goodResult = applySm2(state, "good");
  const hardResult = applySm2(state, "hard");
  assert.ok(
    hardResult.intervalDays <= goodResult.intervalDays,
    `hard interval (${hardResult.intervalDays}) should be <= good (${goodResult.intervalDays})`,
  );
});

// ---- EF floor -----------------------------------------------------------

test("easeFactor never goes below 1.3 regardless of grade", () => {
  const worstState = { intervalDays: 30, easeFactor: 1.3, repetitions: 5 };
  for (const grade of ["again", "hard", "good", "easy"] as const) {
    const result = applySm2(worstState, grade);
    assert.ok(
      result.easeFactor >= 1.3,
      `grade=${grade} dropped EF to ${result.easeFactor}`,
    );
  }
});
