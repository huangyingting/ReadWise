/**
 * Today Session — idempotent generator (#790).
 *
 * Covers existing-session return, resume selection + stale exclusion, Picks
 * fallback, no-candidate fallback, and the concurrent-create (P2002) race.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";

type ProgressRow = {
  articleId: string;
  userId: string;
  percent: number;
  completed: boolean;
  updatedAt: Date;
};

// ---- mutable mock state --------------------------------------------------
let existingSession: Record<string, unknown> | null = null;
let createdData: Record<string, unknown> | null = null;
let progressRows: ProgressRow[] = [];
let pickArticles: Array<{ id: string }> = [];
let findUniqueCalls = 0;
let throwP2002OnCreate = false;
let winnerOnReRead: Record<string, unknown> | null = null;

const NOW = new Date("2026-06-27T12:00:00Z");

function persistedRow(data: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "ts-new",
    timezoneSnapshot: "UTC",
    status: "active",
    completionTier: "none",
    readingCompletedAt: null,
    comprehensionCompletedAt: null,
    wordReviewCompletedAt: null,
    completedAt: null,
    skipped: false,
    skipReason: null,
    skippedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...data,
  };
}

before(() => {
  mock.module("@/lib/article-library", {
    namedExports: { publicListableArticleWhere: () => ({}) },
  });
  mock.module("@/lib/recommendations/picks", {
    namedExports: {
      listScoredPicksPage: async () => ({
        articles: pickArticles,
        hasMore: false,
        reasons: {},
        scored: {},
      }),
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        todaySession: {
          findUnique: async () => {
            findUniqueCalls += 1;
            // First read returns the existing session (or null); a re-read after
            // a P2002 returns the race winner.
            if (findUniqueCalls === 1) return existingSession;
            return winnerOnReRead ?? existingSession;
          },
          create: async ({ data }: { data: Record<string, unknown> }) => {
            if (throwP2002OnCreate) {
              throw new Prisma.PrismaClientKnownRequestError(
                "Unique constraint failed",
                { code: "P2002", clientVersion: "test" },
              );
            }
            createdData = data;
            return persistedRow(data);
          },
        },
        readingProgress: {
          // Honour the where filter so stale/out-of-range rows are excluded.
          findFirst: async ({ where }: { where: Record<string, any> }) => {
            const minP = where.percent?.gte ?? -Infinity;
            const maxP = where.percent?.lte ?? Infinity;
            const cutoff: Date | undefined = where.updatedAt?.gte;
            const matches = progressRows
              .filter(
                (r) =>
                  r.completed === false &&
                  r.percent >= minP &&
                  r.percent <= maxP &&
                  (!cutoff || r.updatedAt.getTime() >= cutoff.getTime()),
              )
              .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
            const row = matches[0];
            return row ? { articleId: row.articleId } : null;
          },
        },
        savedWord: {
          findMany: async () => [],
        },
      },
    },
  });
});

beforeEach(() => {
  existingSession = null;
  createdData = null;
  progressRows = [];
  pickArticles = [];
  findUniqueCalls = 0;
  throwP2002OnCreate = false;
  winnerOnReRead = null;
});

const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

test("returns the existing session unchanged (idempotent)", async () => {
  const { getOrCreateTodaySession } = await import(
    "@/lib/engagement/today-session/generator"
  );
  existingSession = persistedRow({
    id: "ts-existing",
    userId: "u1",
    localDate: "2026-06-27",
    primaryArticleId: "a-old",
    backupArticleIds: [],
    targetSavedWordIds: [],
    reviewTargetCount: 0,
    source: "picks",
    generationReasonCode: "picks_primary",
  });
  const res = await getOrCreateTodaySession({
    userId: "u1",
    localDate: "2026-06-27",
    timezoneSnapshot: "UTC",
    now: NOW,
  });
  assert.equal(res.id, "ts-existing");
  assert.equal(createdData, null, "must not create when one exists");
});

test("selects a recent in-progress article as resume (source=resume)", async () => {
  const { getOrCreateTodaySession } = await import(
    "@/lib/engagement/today-session/generator"
  );
  progressRows = [
    { articleId: "a-resume", userId: "u1", percent: 40, completed: false, updatedAt: daysAgo(1) },
  ];
  pickArticles = [{ id: "p1" }, { id: "p2" }];
  const res = await getOrCreateTodaySession({
    userId: "u1",
    localDate: "2026-06-27",
    timezoneSnapshot: "UTC",
    now: NOW,
  });
  assert.equal(res.source, "resume");
  assert.equal(res.generationReasonCode, "resume_in_progress");
  assert.equal(res.primaryArticleId, "a-resume");
  // Backups come from Picks and never duplicate the primary.
  assert.deepEqual(res.backupArticleIds, ["p1", "p2"]);
  assert.ok(!res.backupArticleIds.includes("a-resume"));
});

test("excludes stale (>7d) and out-of-range progress from resume", async () => {
  const { getOrCreateTodaySession } = await import(
    "@/lib/engagement/today-session/generator"
  );
  progressRows = [
    { articleId: "a-stale", userId: "u1", percent: 50, completed: false, updatedAt: daysAgo(30) },
    { articleId: "a-too-low", userId: "u1", percent: 5, completed: false, updatedAt: daysAgo(1) },
    { articleId: "a-too-high", userId: "u1", percent: 96, completed: false, updatedAt: daysAgo(1) },
  ];
  pickArticles = [{ id: "p1" }, { id: "p2" }];
  const res = await getOrCreateTodaySession({
    userId: "u1",
    localDate: "2026-06-27",
    timezoneSnapshot: "UTC",
    now: NOW,
  });
  // No eligible resume → Picks fallback.
  assert.equal(res.source, "picks");
  assert.equal(res.primaryArticleId, "p1");
});

test("falls back to Picks for primary + stable backups", async () => {
  const { getOrCreateTodaySession } = await import(
    "@/lib/engagement/today-session/generator"
  );
  pickArticles = [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }];
  const res = await getOrCreateTodaySession({
    userId: "u1",
    localDate: "2026-06-27",
    timezoneSnapshot: "UTC",
    now: NOW,
  });
  assert.equal(res.source, "picks");
  assert.equal(res.generationReasonCode, "picks_primary");
  assert.equal(res.primaryArticleId, "p1");
  assert.deepEqual(res.backupArticleIds, ["p2", "p3", "p4"]);
});

test("no-candidate fallback yields null primary + browse/import state", async () => {
  const { getOrCreateTodaySession } = await import(
    "@/lib/engagement/today-session/generator"
  );
  progressRows = [];
  pickArticles = [];
  const res = await getOrCreateTodaySession({
    userId: "u1",
    localDate: "2026-06-27",
    timezoneSnapshot: "UTC",
    now: NOW,
  });
  assert.equal(res.primaryArticleId, null);
  assert.equal(res.source, "none");
  assert.equal(res.generationReasonCode, "no_candidate");
  assert.deepEqual(res.backupArticleIds, []);
});

test("concurrent create (P2002) recovers by re-reading the winner", async () => {
  const { getOrCreateTodaySession } = await import(
    "@/lib/engagement/today-session/generator"
  );
  pickArticles = [{ id: "p1" }];
  throwP2002OnCreate = true;
  winnerOnReRead = persistedRow({
    id: "ts-winner",
    userId: "u1",
    localDate: "2026-06-27",
    primaryArticleId: "p1",
    backupArticleIds: [],
    targetSavedWordIds: [],
    reviewTargetCount: 0,
    source: "picks",
    generationReasonCode: "picks_primary",
  });
  const res = await getOrCreateTodaySession({
    userId: "u1",
    localDate: "2026-06-27",
    timezoneSnapshot: "UTC",
    now: NOW,
  });
  assert.equal(res.id, "ts-winner");
});

test("persists ids only — no learning content in the created plan", async () => {
  const { getOrCreateTodaySession } = await import(
    "@/lib/engagement/today-session/generator"
  );
  pickArticles = [{ id: "p1" }, { id: "p2" }];
  await getOrCreateTodaySession({
    userId: "u1",
    localDate: "2026-06-27",
    timezoneSnapshot: "UTC",
    now: NOW,
  });
  assert.ok(createdData);
  const json = JSON.stringify(createdData);
  // Persisted plan is strings/arrays of ids; assert no content-bearing keys.
  for (const banned of ["content", "title", "word", "explanation", "example", "contextSentence"]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(createdData, banned),
      false,
      `created data must not contain ${banned}`,
    );
  }
  assert.match(json, /"backupArticleIds"/);
});
