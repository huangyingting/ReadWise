/**
 * Tests for forward-only, race-safe progress writes (src/lib/progress.ts).
 * All Prisma calls are mocked — no DB required. Verifies forward-only/sticky
 * completion semantics and that a concurrent first-write P2002 is recovered
 * (no uncaught 500 / lost write) by retrying into the update branch.
 */
process.env.LOG_LEVEL = "error";
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";

type Row = {
  id: string;
  userId: string;
  articleId: string;
  percent: number;
  completed: boolean;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// ---- mutable state -------------------------------------------------------
let row: Row | null = null;
/** When set, the next create() throws P2002 after a concurrent writer wins. */
let concurrentCreatePercent: number | null = null;

function makeRow(data: { userId: string; articleId: string; percent: number; completed: boolean; completedAt: Date | null }): Row {
  const now = new Date();
  return { id: "p1", createdAt: now, updatedAt: now, ...data };
}

before(() => {
  mock.module("@/lib/engagement/activity", {
    namedExports: { recordReadingActivity: async () => {} },
  });
  mock.module("@/lib/article-library", {
    namedExports: {
      publicListableArticleWhere: () => ({}),
      toListingArticle: (a: unknown) => a,
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        readingProgress: {
          findUnique: async () => row,
          create: async ({ data }: { data: Row }) => {
            if (concurrentCreatePercent !== null) {
              // Simulate a concurrent writer having created the row first.
              const p = concurrentCreatePercent;
              concurrentCreatePercent = null;
              row = makeRow({
                userId: data.userId,
                articleId: data.articleId,
                percent: p,
                completed: p >= 95,
                completedAt: p >= 95 ? new Date() : null,
              });
              throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
                code: "P2002",
                clientVersion: "test",
              });
            }
            row = makeRow(data);
            return row;
          },
          updateMany: async ({
            where,
            data,
          }: {
            where: { id: string; percent: { lte: number } };
            data: Partial<Row>;
          }) => {
            if (row && row.id === where.id && row.percent <= where.percent.lte) {
              row = { ...row, ...data };
              return { count: 1 };
            }
            return { count: 0 };
          },
        },
      },
    },
  });
});

beforeEach(() => {
  row = null;
  concurrentCreatePercent = null;
});

// ---- forward-only / sticky semantics ------------------------------------

test("saveProgress creates a new row on first write", async () => {
  const { saveProgress } = await import("@/lib/engagement/progress");
  const result = await saveProgress("u1", "a1", 42);
  assert.equal(result.percent, 42);
  assert.equal(result.completed, false);
  assert.equal(result.completedAt, null);
});

test("saveProgress never lowers the stored percent (forward-only)", async () => {
  const { saveProgress } = await import("@/lib/engagement/progress");
  await saveProgress("u1", "a1", 60);
  const result = await saveProgress("u1", "a1", 25);
  assert.equal(result.percent, 60);
});

test("saveProgress marks completed at/above the threshold", async () => {
  const { saveProgress, COMPLETION_THRESHOLD } = await import("@/lib/engagement/progress");
  const result = await saveProgress("u1", "a1", COMPLETION_THRESHOLD);
  assert.equal(result.completed, true);
  assert.ok(result.completedAt instanceof Date);
});

test("saveProgress does NOT mark completed just below the threshold (94%)", async () => {
  const { saveProgress } = await import("@/lib/engagement/progress");
  const result = await saveProgress("u1", "a1", 94);
  assert.equal(result.completed, false);
  assert.equal(result.completedAt, null);
});

test("completion is sticky and percent is not lowered after completing", async () => {
  const { saveProgress } = await import("@/lib/engagement/progress");
  const done = await saveProgress("u1", "a1", 98);
  assert.equal(done.completed, true);
  const completedAt = done.completedAt;
  const later = await saveProgress("u1", "a1", 5);
  assert.equal(later.completed, true);
  assert.equal(later.percent, 98);
  assert.deepEqual(later.completedAt, completedAt);
});

// ---- race safety ---------------------------------------------------------

test("saveProgress recovers from a concurrent first-write P2002 (no 500 / no lost write)", async () => {
  const { saveProgress } = await import("@/lib/engagement/progress");
  // The first create() will throw P2002 after a concurrent writer persisted 40.
  concurrentCreatePercent = 40;
  const result = await saveProgress("u1", "a1", 70);
  // Recovered into the update branch and applied forward-only max(40, 70) = 70.
  assert.equal(result.percent, 70);
  assert.equal(row?.percent, 70);
});

test("concurrent P2002 where the other writer is ahead keeps the higher percent", async () => {
  const { saveProgress } = await import("@/lib/engagement/progress");
  // Concurrent writer persisted 90; our incoming 50 must not lower it.
  concurrentCreatePercent = 90;
  const result = await saveProgress("u1", "a1", 50);
  assert.equal(result.percent, 90);
});

// ---- clampPercent edge inputs -------------------------------------------

test("clampPercent(NaN) clamps to 0", async () => {
  const { clampPercent } = await import("@/lib/engagement/progress");
  assert.equal(clampPercent(NaN), 0);
});

test("clampPercent(Infinity) clamps to 100", async () => {
  const { clampPercent } = await import("@/lib/engagement/progress");
  assert.equal(clampPercent(Infinity), 100);
});
