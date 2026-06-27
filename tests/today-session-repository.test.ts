/**
 * Today Session — repository user-scoping, mapping, and validation (#789).
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type Row = Record<string, unknown>;

let findUniqueArg: Row | null = null;
let updateManyArg: Row | null = null;
let storedRow: Row | null = null;
let updateManyCount = 1;

function baseRow(overrides: Row = {}): Row {
  const now = new Date("2026-06-27T00:00:00Z");
  return {
    id: "ts1",
    userId: "u1",
    localDate: "2026-06-27",
    timezoneSnapshot: "UTC",
    primaryArticleId: "a1",
    backupArticleIds: ["a2", "a3"],
    targetSavedWordIds: ["w1"],
    reviewTargetCount: 1,
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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        todaySession: {
          findUnique: async ({ where }: { where: Row }) => {
            findUniqueArg = where;
            return storedRow;
          },
          create: async ({ data }: { data: Row }) => {
            storedRow = baseRow(data);
            return storedRow;
          },
          updateMany: async ({ where }: { where: Row }) => {
            updateManyArg = where;
            return { count: updateManyCount };
          },
        },
      },
    },
  });
});

beforeEach(() => {
  findUniqueArg = null;
  updateManyArg = null;
  storedRow = null;
  updateManyCount = 1;
});

test("getTodaySession scopes by userId + localDate and returns null when missing", async () => {
  const { getTodaySession } = await import(
    "@/lib/engagement/today-session/repository"
  );
  storedRow = null;
  const res = await getTodaySession("u1", "2026-06-27");
  assert.equal(res, null);
  assert.deepEqual(findUniqueArg, {
    userId_localDate: { userId: "u1", localDate: "2026-06-27" },
  });
});

test("getTodaySession maps a row into the privacy-safe view", async () => {
  const { getTodaySession } = await import(
    "@/lib/engagement/today-session/repository"
  );
  storedRow = baseRow();
  const res = await getTodaySession("u1", "2026-06-27");
  assert.ok(res);
  assert.equal(res.status, "active");
  assert.deepEqual(res.backupArticleIds, ["a2", "a3"]);
  assert.deepEqual(res.targetSavedWordIds, ["w1"]);
  // View has no content columns.
  assert.equal("word" in res, false);
  assert.equal("content" in res, false);
});

test("toTodaySessionView coerces unknown controlled values to safe defaults", async () => {
  const { toTodaySessionView } = await import(
    "@/lib/engagement/today-session/repository"
  );
  const view = toTodaySessionView(
    baseRow({ status: "garbage", source: "x", completionTier: "y" }) as never,
  );
  assert.equal(view.status, "active");
  assert.equal(view.source, "none");
  assert.equal(view.completionTier, "none");
});

test("createTodaySession rejects an invalid source before persistence", async () => {
  const { createTodaySession } = await import(
    "@/lib/engagement/today-session/repository"
  );
  await assert.rejects(
    () =>
      createTodaySession({
        userId: "u1",
        localDate: "2026-06-27",
        timezoneSnapshot: "UTC",
        plan: {
          primaryArticleId: "a1",
          backupArticleIds: [],
          targetSavedWordIds: [],
          reviewTargetCount: 0,
          source: "invalid" as never,
          generationReasonCode: "picks_primary",
        },
      }),
    /Invalid TodaySession source/,
  );
});

test("updateTodaySession scopes updateMany by userId AND localDate", async () => {
  const { updateTodaySession } = await import(
    "@/lib/engagement/today-session/repository"
  );
  storedRow = baseRow({ status: "completed" });
  const res = await updateTodaySession("u1", "2026-06-27", {
    status: "completed",
  });
  assert.ok(res);
  assert.deepEqual(updateManyArg, { userId: "u1", localDate: "2026-06-27" });
});

test("updateTodaySession returns null when no row matched the user", async () => {
  const { updateTodaySession } = await import(
    "@/lib/engagement/today-session/repository"
  );
  updateManyCount = 0;
  const res = await updateTodaySession("intruder", "2026-06-27", {
    status: "completed",
  });
  assert.equal(res, null);
});

test("updateTodaySession rejects an invalid skip reason", async () => {
  const { updateTodaySession } = await import(
    "@/lib/engagement/today-session/repository"
  );
  await assert.rejects(
    () =>
      updateTodaySession("u1", "2026-06-27", {
        skipped: true,
        skipReason: "because",
      }),
    /Invalid TodaySession skipReason/,
  );
});
