/**
 * Reading fluency trend tests (#813).
 *
 * `computeFluencyTrend` is a pure function — no mocks needed. Covers the four
 * controlled states (improving / stable / declining / insufficient_data, incl.
 * the < 3 data-point boundary) and the privacy invariant: the result carries
 * only aggregate WPM + the controlled enum + the sample count + filters, never
 * any per-article WPM value or article id/content.
 */
process.env.LOG_LEVEL = "error";

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SpeedRecord } from "@/lib/engagement/reading-speed";

/** Build a record that yields `wpm` words-per-minute (1 minute of active time). */
function rec(wpm: number): SpeedRecord {
  return { wordCount: wpm, timeSpentMs: 60_000 };
}

describe("computeFluencyTrend", () => {
  test("insufficient_data with fewer than 3 valid samples", async () => {
    const { computeFluencyTrend } = await import("@/lib/engagement/reading-speed");
    const result = computeFluencyTrend([rec(200), rec(220)]);
    assert.equal(result.trend, "insufficient_data");
    assert.equal(result.avgWpm, null);
    assert.equal(result.sampleCount, 2);
  });

  test("insufficient_data when rows have zero active time (no valid WPM)", async () => {
    const { computeFluencyTrend } = await import("@/lib/engagement/reading-speed");
    const records: SpeedRecord[] = [
      { wordCount: 200, timeSpentMs: 0 },
      { wordCount: 200, timeSpentMs: 0 },
      { wordCount: 200, timeSpentMs: 0 },
    ];
    const result = computeFluencyTrend(records);
    assert.equal(result.trend, "insufficient_data");
    assert.equal(result.sampleCount, 0);
    assert.equal(result.avgWpm, null);
  });

  test("stable with exactly 3 samples and only one window", async () => {
    const { computeFluencyTrend } = await import("@/lib/engagement/reading-speed");
    const result = computeFluencyTrend([rec(200), rec(205), rec(210)]);
    assert.equal(result.trend, "stable");
    assert.notEqual(result.avgWpm, null);
    assert.equal(result.sampleCount, 3);
  });

  test("improving when recent 5 mean exceeds prior 5 by >= delta", async () => {
    const { computeFluencyTrend } = await import("@/lib/engagement/reading-speed");
    const prior = [rec(150), rec(150), rec(150), rec(150), rec(150)];
    const recent = [rec(250), rec(250), rec(250), rec(250), rec(250)];
    const result = computeFluencyTrend([...prior, ...recent]);
    assert.equal(result.trend, "improving");
    assert.equal(result.sampleCount, 10);
  });

  test("declining when recent 5 mean is below prior 5 by >= delta", async () => {
    const { computeFluencyTrend } = await import("@/lib/engagement/reading-speed");
    const prior = [rec(250), rec(250), rec(250), rec(250), rec(250)];
    const recent = [rec(150), rec(150), rec(150), rec(150), rec(150)];
    const result = computeFluencyTrend([...prior, ...recent]);
    assert.equal(result.trend, "declining");
  });

  test("stable when recent vs prior change is within the delta band", async () => {
    const { computeFluencyTrend } = await import("@/lib/engagement/reading-speed");
    const prior = [rec(200), rec(200), rec(200), rec(200), rec(200)];
    const recent = [rec(202), rec(202), rec(202), rec(202), rec(202)];
    const result = computeFluencyTrend([...prior, ...recent]);
    assert.equal(result.trend, "stable");
  });

  test("threads through the level / category filters it was given", async () => {
    const { computeFluencyTrend } = await import("@/lib/engagement/reading-speed");
    const result = computeFluencyTrend([rec(200), rec(210), rec(220)], {
      level: "B1",
      category: "tech",
    });
    assert.equal(result.levelFilter, "B1");
    assert.equal(result.categoryFilter, "tech");
  });

  test("privacy: result keys are aggregate-only — no per-article WPM or ids", async () => {
    const { computeFluencyTrend } = await import("@/lib/engagement/reading-speed");
    const result = computeFluencyTrend([rec(200), rec(210), rec(220), rec(230)]);
    assert.deepEqual(
      Object.keys(result).sort(),
      ["avgWpm", "categoryFilter", "levelFilter", "sampleCount", "trend"].sort(),
    );
    // No array of per-article WPM values and no article id field leak through.
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("articleId"));
    assert.ok(!/\[/.test(serialized), "no array (per-article series) in payload");
  });
});

describe("getFluencyTrend repo (privacy + filter wiring)", () => {
  test("response shape is aggregate-only and honours the level filter query", async () => {
    const { mock } = await import("node:test");
    let capturedWhere: Record<string, unknown> = {};
    mock.module("@/lib/prisma", {
      namedExports: {
        prisma: {
          articleMastery: {
            findMany: async (args: { where: Record<string, unknown> }) => {
              capturedWhere = args.where;
              return [
                { timeSpentMs: 60_000, article: { wordCount: 200 } },
                { timeSpentMs: 60_000, article: { wordCount: 210 } },
                { timeSpentMs: 60_000, article: { wordCount: 220 } },
              ];
            },
          },
        },
      },
    });
    const { getFluencyTrend } = await import("@/lib/engagement/reading-speed-repo");
    const result = await getFluencyTrend("u1", { level: "B1", category: "tech" });

    assert.equal(result.levelFilter, "B1");
    assert.equal(result.categoryFilter, "tech");
    assert.equal(result.sampleCount, 3);
    // The article filter forwarded both difficulty + category.
    const articleWhere = capturedWhere.article as Record<string, unknown>;
    assert.equal(articleWhere.difficulty, "B1");
    assert.equal(articleWhere.category, "tech");
    // Privacy: no per-article WPM value field on the response.
    assert.ok(!Object.prototype.hasOwnProperty.call(result, "wpmPerArticle"));
    mock.reset();
  });
});
