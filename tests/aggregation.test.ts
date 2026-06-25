/**
 * Tests for pure aggregation helpers (REF-085).
 *
 * Covers: percentage, wholePercentage, averageRounded, isoWeek,
 *         lastNWeeks, fillWeekBuckets.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  percentage,
  wholePercentage,
  averageRounded,
  isoWeek,
  lastNWeeks,
  fillWeekBuckets,
} from "@/lib/aggregation";

// ---------------------------------------------------------------------------
// percentage
// ---------------------------------------------------------------------------

describe("percentage", () => {
  test("returns 0 for zero denominator", () => {
    assert.strictEqual(percentage(10, 0), 0);
  });

  test("returns 0 for negative denominator", () => {
    assert.strictEqual(percentage(5, -1), 0);
  });

  test("calculates a simple percentage with default precision", () => {
    assert.strictEqual(percentage(1, 4), 25);
  });

  test("rounds to 1 decimal place by default", () => {
    assert.strictEqual(percentage(1, 3), 33.3);
  });

  test("respects custom precision", () => {
    assert.strictEqual(percentage(1, 3, 2), 33.33);
  });

  test("returns 100 for equal numerator and denominator", () => {
    assert.strictEqual(percentage(7, 7), 100);
  });
});

// ---------------------------------------------------------------------------
// wholePercentage
// ---------------------------------------------------------------------------

describe("wholePercentage", () => {
  test("returns a whole number", () => {
    assert.strictEqual(wholePercentage(1, 3), 33);
  });

  test("returns 0 for zero denominator", () => {
    assert.strictEqual(wholePercentage(5, 0), 0);
  });

  test("returns 100 for full ratio", () => {
    assert.strictEqual(wholePercentage(10, 10), 100);
  });
});

// ---------------------------------------------------------------------------
// averageRounded
// ---------------------------------------------------------------------------

describe("averageRounded", () => {
  test("returns null for an empty array", () => {
    assert.strictEqual(averageRounded([]), null);
  });

  test("returns the value itself for a single-element array", () => {
    assert.strictEqual(averageRounded([5]), 5);
  });

  test("rounds the mean", () => {
    // mean of [1, 2] = 1.5 → rounds to 2
    assert.strictEqual(averageRounded([1, 2]), 2);
  });

  test("handles larger arrays", () => {
    assert.strictEqual(averageRounded([10, 20, 30]), 20);
  });
});

// ---------------------------------------------------------------------------
// isoWeek
// ---------------------------------------------------------------------------

describe("isoWeek", () => {
  test("returns a YYYY-WNN string", () => {
    const result = isoWeek(new Date("2025-01-06")); // Monday of week 2, 2025
    assert.match(result, /^\d{4}-W\d{2}$/);
  });

  test("pads single-digit week numbers", () => {
    // 2025-01-01 is week 01
    const result = isoWeek(new Date("2025-01-01"));
    assert.ok(result.endsWith("-W01") || result.endsWith("-W52") || result.endsWith("-W53"),
      `Expected week 01 or the last week of 2024, got: ${result}`);
  });

  test("is consistent for the same week", () => {
    const monday = isoWeek(new Date("2025-06-09")); // Monday
    const friday = isoWeek(new Date("2025-06-13")); // Friday same week
    assert.strictEqual(monday, friday);
  });

  test("differs for consecutive weeks", () => {
    const week1 = isoWeek(new Date("2025-06-09"));
    const week2 = isoWeek(new Date("2025-06-16"));
    assert.notStrictEqual(week1, week2);
  });
});

// ---------------------------------------------------------------------------
// lastNWeeks
// ---------------------------------------------------------------------------

describe("lastNWeeks", () => {
  test("returns exactly n buckets", () => {
    const buckets = lastNWeeks(4, new Date("2025-06-20"));
    assert.strictEqual(buckets.length, 4);
  });

  test("all initial counts are 0", () => {
    const buckets = lastNWeeks(3, new Date("2025-06-20"));
    assert.ok(buckets.every((b) => b.count === 0));
  });

  test("returns buckets in chronological order (oldest first)", () => {
    const buckets = lastNWeeks(3, new Date("2025-06-20"));
    assert.ok(buckets[0].week <= buckets[1].week);
    assert.ok(buckets[1].week <= buckets[2].week);
  });

  test("each bucket has a YYYY-WNN week string", () => {
    const buckets = lastNWeeks(2, new Date("2025-06-20"));
    for (const b of buckets) {
      assert.match(b.week, /^\d{4}-W\d{2}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// fillWeekBuckets
// ---------------------------------------------------------------------------

describe("fillWeekBuckets", () => {
  test("returns buckets with counts merged from rows", () => {
    const anchor = new Date("2025-06-20");
    const buckets = lastNWeeks(2, anchor);
    const [older, newer] = buckets;

    const rows = [
      { date: new Date("2025-06-09"), count: 3 }, // first bucket week
      { date: new Date("2025-06-16"), count: 7 }, // second bucket week
    ];

    const filled = fillWeekBuckets(buckets, rows);
    assert.strictEqual(filled[0].count, 3);
    assert.strictEqual(filled[1].count, 7);
    // original references should not be mutated
    assert.strictEqual(older.count, 0);
    assert.strictEqual(newer.count, 0);
  });

  test("returns 0 for weeks with no rows", () => {
    const buckets = lastNWeeks(2, new Date("2025-06-20"));
    const filled = fillWeekBuckets(buckets, []);
    assert.ok(filled.every((b) => b.count === 0));
  });

  test("accumulates multiple rows in the same week", () => {
    const buckets = lastNWeeks(1, new Date("2025-06-20"));
    const rows = [
      { date: new Date("2025-06-16"), count: 2 },
      { date: new Date("2025-06-17"), count: 5 },
    ];
    const filled = fillWeekBuckets(buckets, rows);
    assert.strictEqual(filled[0].count, 7);
  });
});
