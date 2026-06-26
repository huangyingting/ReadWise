/**
 * Unit tests for getReadingSpeedStats in src/lib/engagement/reading-speed-repo.ts.
 *
 * Prisma is fully mocked — no database required. These tests cover:
 * - empty result → nulls and sessionCount 0
 * - timeSpentMs=0 excluded via the gt:0 query filter
 * - take:50 boundary asserted on the query args
 * - computeWpmTrend delegation verified via valid records
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

let findManyResult: Array<{ timeSpentMs: number | null; article: { wordCount: number | null } }> = [];
let capturedArgs: Record<string, unknown> = {};

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        articleMastery: {
          findMany: async (args: Record<string, unknown>) => {
            capturedArgs = args;
            return findManyResult;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  findManyResult = [];
  capturedArgs = {};
});

test("getReadingSpeedStats: empty result → all nulls and sessionCount 0", async () => {
  const { getReadingSpeedStats } = await import("@/lib/engagement/reading-speed-repo");
  const result = await getReadingSpeedStats("user-empty");
  assert.strictEqual(result.averageWpm, null);
  assert.strictEqual(result.recentWpm, null);
  assert.strictEqual(result.sessionCount, 0);
});

test("getReadingSpeedStats: query filters timeSpentMs with gt:0", async () => {
  const { getReadingSpeedStats } = await import("@/lib/engagement/reading-speed-repo");
  await getReadingSpeedStats("user-filter");
  const where = capturedArgs.where as { timeSpentMs: { gt: number } };
  assert.deepStrictEqual(where.timeSpentMs, { gt: 0 });
});

test("getReadingSpeedStats: query uses take:50", async () => {
  const { getReadingSpeedStats } = await import("@/lib/engagement/reading-speed-repo");
  await getReadingSpeedStats("user-take");
  assert.strictEqual(capturedArgs.take, 50);
});

test("getReadingSpeedStats: rows with null timeSpentMs are excluded from records", async () => {
  const { getReadingSpeedStats } = await import("@/lib/engagement/reading-speed-repo");
  findManyResult = [
    { timeSpentMs: null, article: { wordCount: 200 } },
    { timeSpentMs: 60_000, article: { wordCount: 200 } },
  ];
  const result = await getReadingSpeedStats("user-null-time");
  assert.strictEqual(result.sessionCount, 1);
});

test("getReadingSpeedStats: delegates to computeWpmTrend — valid records return correct wpm", async () => {
  const { getReadingSpeedStats } = await import("@/lib/engagement/reading-speed-repo");
  // 200 words / 60 s = 200 wpm, 300 words / 60 s = 300 wpm → average 250
  findManyResult = [
    { timeSpentMs: 60_000, article: { wordCount: 200 } },
    { timeSpentMs: 60_000, article: { wordCount: 300 } },
  ];
  const result = await getReadingSpeedStats("user-wpm");
  assert.strictEqual(result.sessionCount, 2);
  assert.strictEqual(result.averageWpm, 250);
  assert.ok(result.recentWpm !== null, "recentWpm should be non-null with valid records");
});
