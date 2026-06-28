/**
 * Domain tests for setTodayPrimaryArticle (Today Session v1.1, #805).
 *
 * No real DB — `@/lib/prisma` is mocked with a tiny fixture article set whose
 * `article.findFirst` HONOURS the policy `where` produced by
 * `readableArticleWhere` (so the IDOR/access assertions exercise the real Article
 * Library access rules, not a hand-rolled check). Verifies:
 *   - IDOR: another user's PRIVATE article is not settable (→ not_found, no write);
 *   - a learner CAN set their own readable public/private PUBLISHED article;
 *   - a PROCESSING / FAILED article is blocked with a clear not_ready error;
 *   - replacing the primary preserves the replaced id (appended to backups) and
 *     NEVER reads/deletes/alters ReadingProgress;
 *   - `source` becomes `user_selected`; re-selection is idempotent;
 *   - the replaced generated id is retained for analytics.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { ArticleStatus, ArticleVisibility } from "@prisma/client";

const USER_ID = "user-1";
const OTHER_ID = "user-2";
// Anchored to the current UTC day so the pre-seeded Today session matches the
// localDate the route/generator resolves from `new Date()` (avoids date-rollover
// flakiness). Format matches dateKey(now, "UTC").
const LOCAL_DATE = new Date().toISOString().slice(0, 10);

type Row = Record<string, unknown>;
type ArticleFixture = {
  id: string;
  visibility: ArticleVisibility;
  status: ArticleStatus;
  ownerId: string | null;
};

// Fixture universe. Equality on visibility/status/ownerId matches the enum
// values the policy where-builder emits, so the mock can evaluate the where.
const ARTICLES: ArticleFixture[] = [
  { id: "pub1", visibility: ArticleVisibility.PUBLIC, status: ArticleStatus.PUBLISHED, ownerId: null },
  { id: "priv1", visibility: ArticleVisibility.PRIVATE, status: ArticleStatus.PUBLISHED, ownerId: USER_ID },
  { id: "other1", visibility: ArticleVisibility.PRIVATE, status: ArticleStatus.PUBLISHED, ownerId: OTHER_ID },
  { id: "proc1", visibility: ArticleVisibility.PRIVATE, status: ArticleStatus.PROCESSING, ownerId: USER_ID },
  { id: "fail1", visibility: ArticleVisibility.PRIVATE, status: ArticleStatus.FAILED, ownerId: USER_ID },
];

/** True when a fixture satisfies every scalar key of a single where branch. */
function branchMatches(a: ArticleFixture, branch: Row): boolean {
  return Object.entries(branch).every(([k, v]) => (a as Record<string, unknown>)[k] === v);
}

/** Evaluate a `readableArticleWhere`-shaped where against a fixture. */
function articleMatches(a: ArticleFixture, where: Row): boolean {
  if (where.id !== undefined && a.id !== where.id) return false;
  if (Array.isArray(where.OR)) {
    return (where.OR as Row[]).some((branch) => branchMatches(a, branch));
  }
  // Operator (admin/system) where carries no OR — id-only match already passed.
  const { OR: _omit, ...scalars } = where;
  void _omit;
  return branchMatches(a, scalars as Row);
}

let sessionRow: Row | null = null;
let progressTouches: string[] = [];

function makeRow(overrides: Row = {}): Row {
  return {
    id: "ts1",
    userId: USER_ID,
    localDate: LOCAL_DATE,
    timezoneSnapshot: "UTC",
    primaryArticleId: "gen1",
    backupArticleIds: ["b1"],
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

// Any ReadingProgress mutation/read records a touch so tests can assert the
// override never goes near reading-progress facts.
const readingProgressSpy = new Proxy(
  {},
  {
    get(_t, prop: string) {
      return async () => {
        progressTouches.push(prop);
        return prop === "findFirst" || prop === "findUnique" ? null : { count: 0 };
      };
    },
  },
);

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
        readingProgress: readingProgressSpy,
        article: {
          findFirst: async ({ where }: { where: Row }) => {
            const hit = ARTICLES.find((a) => articleMatches(a, where));
            return hit ? { ...hit } : null;
          },
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
  progressTouches = [];
});

async function setArticle(articleId: string, user = { id: USER_ID, role: "Reader" }) {
  const { setTodayPrimaryArticle } = await import(
    "@/lib/engagement/today-session/set-article"
  );
  return setTodayPrimaryArticle({ user, articleId, requestTimezone: "UTC" });
}

async function expectError(articleId: string, user = { id: USER_ID, role: "Reader" }) {
  const { SetTodayArticleError } = await import(
    "@/lib/engagement/today-session/set-article"
  );
  try {
    await setArticle(articleId, user);
    assert.fail("expected SetTodayArticleError");
  } catch (err) {
    assert.ok(err instanceof SetTodayArticleError, `not a SetTodayArticleError: ${err}`);
    return err as InstanceType<typeof SetTodayArticleError>;
  }
}

test("IDOR: another user's private article is not settable (not_found, no write)", async () => {
  const err = await expectError("other1");
  assert.equal(err.code, "not_found");
  // The session primary/source are untouched — nothing was written.
  assert.equal(sessionRow?.primaryArticleId, "gen1");
  assert.equal(sessionRow?.source, "picks");
});

test("missing article id is not settable (not_found)", async () => {
  const err = await expectError("does-not-exist");
  assert.equal(err.code, "not_found");
  assert.equal(sessionRow?.source, "picks");
});

test("learner can set their own readable PUBLIC published article", async () => {
  const view = await setArticle("pub1");
  assert.equal(view.primaryArticleId, "pub1");
  assert.equal(view.source, "user_selected");
});

test("learner can set their own readable PRIVATE published article", async () => {
  const view = await setArticle("priv1");
  assert.equal(view.primaryArticleId, "priv1");
  assert.equal(view.source, "user_selected");
});

test("PROCESSING article is blocked with a clear not_ready error", async () => {
  const err = await expectError("proc1");
  assert.equal(err.code, "not_ready");
  assert.match(err.message, /process/i);
  assert.equal(sessionRow?.primaryArticleId, "gen1");
  assert.equal(sessionRow?.source, "picks");
});

test("FAILED import is blocked with a clear not_ready error", async () => {
  const err = await expectError("fail1");
  assert.equal(err.code, "not_ready");
  assert.match(err.message, /fail|process/i);
  assert.equal(sessionRow?.source, "picks");
});

test("replacing the primary preserves the replaced generated id as a backup", async () => {
  const view = await setArticle("pub1");
  // Prior generated primary "gen1" is retained (appended) for analytics/fallback.
  assert.ok(view.backupArticleIds.includes("gen1"), "replaced id retained");
  assert.ok(view.backupArticleIds.includes("b1"), "existing backups retained");
  // The new primary is never listed among its own backups.
  assert.ok(!view.backupArticleIds.includes("pub1"));
});

test("setting the primary NEVER reads, deletes, or alters ReadingProgress", async () => {
  await setArticle("pub1");
  assert.deepEqual(progressTouches, [], `ReadingProgress was touched: ${progressTouches}`);
});

test("re-selecting the active user-chosen primary is idempotent", async () => {
  sessionRow = makeRow({ primaryArticleId: "pub1", source: "user_selected", backupArticleIds: ["b1"] });
  const view = await setArticle("pub1");
  assert.equal(view.primaryArticleId, "pub1");
  assert.equal(view.source, "user_selected");
  // No duplicate self-reference introduced into backups.
  assert.deepEqual(view.backupArticleIds, ["b1"]);
});

test("a new primary that was a prior backup is removed from the backup list", async () => {
  sessionRow = makeRow({ primaryArticleId: "gen1", backupArticleIds: ["pub1", "b1"] });
  const view = await setArticle("pub1");
  assert.equal(view.primaryArticleId, "pub1");
  assert.ok(!view.backupArticleIds.includes("pub1"));
  assert.ok(view.backupArticleIds.includes("gen1"));
  assert.ok(view.backupArticleIds.includes("b1"));
});
