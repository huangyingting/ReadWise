/**
 * Unit tests for getActivityHeatmap in src/lib/engagement/heatmap-repo.ts.
 *
 * Prisma is fully mocked — no database required. These tests cover:
 * - empty result → 365 zero cells
 * - in-window rows mapped to the correct cells
 * - >53-week cutoff asserted on the query gte filter
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

let findManyResult: Array<{ date: Date; articlesRead: number }> = [];
let capturedArgs: Record<string, unknown> = {};

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        dailyActivity: {
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

test("getActivityHeatmap: empty DB result → exactly 365 zero cells", async () => {
  const { getActivityHeatmap } = await import("@/lib/engagement/heatmap-repo");
  const cells = await getActivityHeatmap("user-empty");
  assert.strictEqual(cells.length, 365);
  assert.ok(cells.every((c) => c.count === 0 && c.level === 0), "all cells should be zero");
});

test("getActivityHeatmap: query includes gte cutoff approximately 53 weeks ago", async () => {
  const { getActivityHeatmap } = await import("@/lib/engagement/heatmap-repo");
  const before = Date.now();
  await getActivityHeatmap("user-cutoff");
  const after = Date.now();

  const where = capturedArgs.where as { date: { gte: Date } };
  const gte = where.date.gte;
  assert.ok(gte instanceof Date, "gte should be a Date");

  const expectedMs = 53 * 7 * 86_400_000;
  const actualMs = (before + after) / 2 - gte.getTime();
  // Allow ±5 s tolerance around the 53-week window
  assert.ok(
    Math.abs(actualMs - expectedMs) < 5_000,
    `gte should be ~53 weeks ago; diff was ${actualMs - expectedMs} ms`,
  );
});

test("getActivityHeatmap: in-window rows are mapped to the correct cell", async () => {
  const { getActivityHeatmap } = await import("@/lib/engagement/heatmap-repo");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  findManyResult = [{ date: today, articlesRead: 4 }];

  const cells = await getActivityHeatmap("user-mapped");
  assert.strictEqual(cells.length, 365);
  const todayCell = cells.find((c) => c.date === todayStr);
  assert.ok(todayCell, "today's cell should exist in results");
  assert.strictEqual(todayCell!.count, 4);
  assert.ok(todayCell!.level > 0, "level should be non-zero for count=4");
});

test("getActivityHeatmap: userId is forwarded in the query where clause", async () => {
  const { getActivityHeatmap } = await import("@/lib/engagement/heatmap-repo");
  await getActivityHeatmap("specific-user-id");
  const where = capturedArgs.where as { userId: string };
  assert.strictEqual(where.userId, "specific-user-id");
});
