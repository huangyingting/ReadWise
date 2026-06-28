/**
 * Domain tests for `skipTodaySession` (#797).
 *
 * Skip is a lifecycle transition scoped to the authenticated user: it validates
 * a controlled reason, marks the day skipped, appends the dismissed primary id
 * to the stable backups (ids only), surfaces the backups for a browse fallback,
 * and enforces a one-skip-per-day limit idempotently. Mocks prisma only.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type Row = Record<string, unknown>;

const USER_ID = "user-1";
// Anchored to the current UTC day so the pre-seeded Today session matches the
// localDate the route/generator resolves from `new Date()` (avoids date-rollover
// flakiness). Format matches dateKey(now, "UTC").
const LOCAL_DATE = new Date().toISOString().slice(0, 10);
let sessionRow: Row | null = null;

function makeRow(overrides: Row = {}): Row {
  return {
    id: "ts1",
    userId: USER_ID,
    localDate: LOCAL_DATE,
    timezoneSnapshot: "UTC",
    primaryArticleId: "a1",
    backupArticleIds: ["b1", "b2"],
    targetSavedWordIds: [],
    reviewTargetCount: 0,
    status: "active",
    source: "picks",
    completionTier: "none",
    generationReasonCode: "picks_primary",
    readingCompletedAt: null,
    comprehensionCompletedAt: null,
    wordReviewCompletedAt: null,
    completedAt: null,
    skipped: false,
    skipReason: null,
    skippedAt: null,
    createdAt: new Date("2026-06-27T00:00:00Z"),
    updatedAt: new Date("2026-06-27T00:00:00Z"),
    ...overrides,
  };
}

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        profile: { findUnique: async () => ({ timezone: "UTC" }) },
        placementResult: { findUnique: async () => null },
        seriesEnrollment: {
          findFirst: async () => null,
          findUnique: async () => null,
        },
        todaySession: {
          findUnique: async ({
            where,
          }: {
            where: { userId_localDate: { userId: string; localDate: string } };
          }) => {
            const k = where.userId_localDate;
            if (!sessionRow) return null;
            return sessionRow.userId === k.userId && sessionRow.localDate === k.localDate
              ? { ...sessionRow }
              : null;
          },
          updateMany: async ({
            where,
            data,
          }: {
            where: { userId: string; localDate: string };
            data: Row;
          }) => {
            if (
              !sessionRow ||
              sessionRow.userId !== where.userId ||
              sessionRow.localDate !== where.localDate
            ) {
              return { count: 0 };
            }
            Object.assign(sessionRow, data);
            return { count: 1 };
          },
        },
      },
    },
  });
});

beforeEach(() => {
  sessionRow = makeRow();
});

async function skip(reason: unknown) {
  const { skipTodaySession } = await import("@/lib/engagement/today-session/skip");
  return skipTodaySession({
    userId: USER_ID,
    skipReason: reason as never,
    requestTimezone: "UTC",
  });
}

test("rejects an invalid controlled skip reason before any write", async () => {
  await assert.rejects(() => skip("totally_made_up"), /Invalid TodaySession skipReason/);
  // Untouched.
  assert.equal(sessionRow?.status, "active");
});

test("skips an active day, appends dismissed primary, surfaces backups", async () => {
  const res = await skip("too_busy");
  assert.equal(res.skipped, true);
  assert.equal(res.limitReached, false);
  assert.equal(res.browseFallback, true);
  assert.deepEqual(res.promotedBackupIds, ["b1", "b2"]);
  assert.equal(sessionRow?.status, "skipped");
  assert.equal(sessionRow?.skipped, true);
  assert.equal(sessionRow?.skipReason, "too_busy");
  assert.ok(sessionRow?.skippedAt instanceof Date);
  // dismissed primary appended to the stable backups (ids only)
  assert.deepEqual(sessionRow?.backupArticleIds, ["b1", "b2", "a1"]);
});

test("does not duplicate a dismissed id already present in backups", async () => {
  sessionRow = makeRow({ primaryArticleId: "b1", backupArticleIds: ["b1", "b2"] });
  await skip("not_interested");
  assert.deepEqual(sessionRow?.backupArticleIds, ["b1", "b2"]);
});

test("enforces a one-skip-per-day limit idempotently", async () => {
  await skip("too_hard");
  const second = await skip("too_easy");
  assert.equal(second.skipped, false);
  assert.equal(second.limitReached, true);
  assert.equal(second.browseFallback, true);
  // reason from the first skip is preserved (no re-write)
  assert.equal(sessionRow?.skipReason, "too_hard");
});

test("a completed day cannot be skipped (limit reached, no browse fallback)", async () => {
  sessionRow = makeRow({ status: "completed", completionTier: "comprehension", completedAt: new Date() });
  const res = await skip("too_easy");
  assert.equal(res.skipped, false);
  assert.equal(res.limitReached, true);
  assert.equal(res.browseFallback, false);
  assert.equal(sessionRow?.status, "completed");
});
