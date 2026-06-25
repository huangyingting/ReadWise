/**
 * Tests for reading speed pure functions (#378).
 *
 * clampActiveTime, computeWpm, and computeWpmTrend are pure — no mocks needed.
 */
process.env.LOG_LEVEL = "error";

import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("clampActiveTime", () => {
  test("clamps negative values to 0", async () => {
    const { clampActiveTime } = await import("@/lib/engagement/reading-speed");
    assert.strictEqual(clampActiveTime(-1000), 0);
  });

  test("passes through values within range", async () => {
    const { clampActiveTime } = await import("@/lib/engagement/reading-speed");
    assert.strictEqual(clampActiveTime(30_000), 30_000);
  });

  test("clamps values above MAX_ACTIVE_TIME_MS", async () => {
    const { clampActiveTime, MAX_ACTIVE_TIME_MS } = await import("@/lib/engagement/reading-speed");
    assert.strictEqual(clampActiveTime(MAX_ACTIVE_TIME_MS + 1), MAX_ACTIVE_TIME_MS);
  });

  test("clamps exactly at MAX_ACTIVE_TIME_MS (boundary)", async () => {
    const { clampActiveTime, MAX_ACTIVE_TIME_MS } = await import("@/lib/engagement/reading-speed");
    assert.strictEqual(clampActiveTime(MAX_ACTIVE_TIME_MS), MAX_ACTIVE_TIME_MS);
  });
});

describe("computeWpm", () => {
  test("returns null for null wordCount", async () => {
    const { computeWpm } = await import("@/lib/engagement/reading-speed");
    assert.strictEqual(computeWpm(null, 60_000), null);
  });

  test("returns null for zero wordCount", async () => {
    const { computeWpm } = await import("@/lib/engagement/reading-speed");
    assert.strictEqual(computeWpm(0, 60_000), null);
  });

  test("returns null when active time is below MIN_ACTIVE_TIME_MS", async () => {
    const { computeWpm, MIN_ACTIVE_TIME_MS } = await import("@/lib/engagement/reading-speed");
    // One millisecond below threshold.
    assert.strictEqual(computeWpm(500, MIN_ACTIVE_TIME_MS - 1), null);
  });

  test("returns valid WPM at exactly MIN_ACTIVE_TIME_MS", async () => {
    const { computeWpm, MIN_ACTIVE_TIME_MS } = await import("@/lib/engagement/reading-speed");
    // 500 words / 5 seconds = 6000 wpm, but clamped to MAX_WPM.
    const wpm = computeWpm(500, MIN_ACTIVE_TIME_MS);
    assert.ok(wpm !== null, "should return a value");
  });

  test("clamps absurdly high WPM to MAX_WPM", async () => {
    const { computeWpm, MAX_WPM } = await import("@/lib/engagement/reading-speed");
    // 10000 words in 5 seconds = 120000 wpm → clamped to MAX_WPM.
    const wpm = computeWpm(10_000, 5_000);
    assert.strictEqual(wpm, MAX_WPM);
  });

  test("clamps absurdly slow WPM to MIN_WPM", async () => {
    const { computeWpm, MIN_WPM } = await import("@/lib/engagement/reading-speed");
    // 1 word in 3600 s = ~0.02 wpm → clamped to MIN_WPM.
    const wpm = computeWpm(1, 3_600_000);
    assert.strictEqual(wpm, MIN_WPM);
  });

  test("computes a realistic reading speed (200 wpm baseline)", async () => {
    const { computeWpm } = await import("@/lib/engagement/reading-speed");
    // 200 words in 60 seconds = 200 wpm.
    const wpm = computeWpm(200, 60_000);
    assert.strictEqual(wpm, 200);
  });

  test("a 2-second blip with many words returns null (too short)", async () => {
    const { computeWpm, MIN_ACTIVE_TIME_MS } = await import("@/lib/engagement/reading-speed");
    // Simulate a 2-second tab-open that would otherwise yield 50000 wpm.
    const shortTime = Math.min(2_000, MIN_ACTIVE_TIME_MS - 1);
    assert.strictEqual(computeWpm(2_000, shortTime), null);
  });
});

describe("computeWpmTrend", () => {
  test("returns all-null when records list is empty", async () => {
    const { computeWpmTrend } = await import("@/lib/engagement/reading-speed");
    const result = computeWpmTrend([]);
    assert.strictEqual(result.averageWpm, null);
    assert.strictEqual(result.recentWpm, null);
  });

  test("returns all-null when no record produces a valid WPM", async () => {
    const { computeWpmTrend } = await import("@/lib/engagement/reading-speed");
    // wordCount=0 → computeWpm returns null for all.
    const result = computeWpmTrend([
      { wordCount: 0, timeSpentMs: 60_000 },
      { wordCount: 0, timeSpentMs: 120_000 },
    ]);
    assert.strictEqual(result.averageWpm, null);
    assert.strictEqual(result.recentWpm, null);
  });

  test("averageWpm is the mean of valid sessions", async () => {
    const { computeWpmTrend } = await import("@/lib/engagement/reading-speed");
    // Two sessions: 200 wpm and 300 wpm → avg 250.
    const result = computeWpmTrend([
      { wordCount: 200, timeSpentMs: 60_000 },  // 200 wpm
      { wordCount: 300, timeSpentMs: 60_000 },  // 300 wpm
    ]);
    assert.strictEqual(result.averageWpm, 250);
  });

  test("recentWpm uses the last N sessions", async () => {
    const { computeWpmTrend } = await import("@/lib/engagement/reading-speed");
    // 5 sessions at 100 wpm then 2 sessions at 400 wpm; recentCount=2 → 400.
    const slow = { wordCount: 100, timeSpentMs: 60_000 };  // 100 wpm
    const fast = { wordCount: 400, timeSpentMs: 60_000 };  // 400 wpm
    const records = [slow, slow, slow, slow, slow, fast, fast];
    const result = computeWpmTrend(records, 2);
    assert.ok(result.averageWpm !== null);
    assert.strictEqual(result.recentWpm, 400);
  });

  test("recentWpm equals averageWpm when fewer sessions than recentCount", async () => {
    const { computeWpmTrend } = await import("@/lib/engagement/reading-speed");
    const records = [{ wordCount: 200, timeSpentMs: 60_000 }];
    const result = computeWpmTrend(records, 5);
    assert.strictEqual(result.averageWpm, 200);
    assert.strictEqual(result.recentWpm, 200);
  });

  test("skips invalid sessions (short time) when computing trend", async () => {
    const { computeWpmTrend } = await import("@/lib/engagement/reading-speed");
    // Mixed: one invalid (1 ms), one valid.
    const records = [
      { wordCount: 200, timeSpentMs: 1 },       // too short → null
      { wordCount: 200, timeSpentMs: 60_000 },  // 200 wpm
    ];
    const result = computeWpmTrend(records);
    assert.strictEqual(result.averageWpm, 200);
  });
});
