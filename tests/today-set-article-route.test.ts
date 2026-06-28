/**
 * Route tests for POST /api/today/set-article (Today Session v1.1, #805).
 *
 * Validates auth, the feature-flag 404, body validation, the access/IDOR
 * mapping (inaccessible → 404, processing/failed → 409), the success path
 * (source becomes user_selected, replaced id retained, view model returned),
 * cross-user scoping, and that the response carries NO article content. Mocks
 * auth + prisma; a pre-seeded session short-circuits generation.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { ArticleStatus, ArticleVisibility } from "@prisma/client";
import { type RouteHandler, jsonPost } from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";

const USER_ID = "user-1";
const OTHER_ID = "user-2";
// Anchored to the current UTC day so the pre-seeded Today session matches the
// localDate the route/generator resolves from `new Date()` (avoids date-rollover
// flakiness). Format matches dateKey(now, "UTC").
const LOCAL_DATE = new Date().toISOString().slice(0, 10);
const FLAG = "FEATURE_TODAY_SESSION_ENABLED";

type Row = Record<string, unknown>;

const ARTICLES: Row[] = [
  { id: "pub1", title: "Public One", author: null, source: null, category: null, difficulty: null, readingMinutes: 4, wordCount: 800, publishedAt: null, heroImage: null, visibility: ArticleVisibility.PUBLIC, status: ArticleStatus.PUBLISHED, ownerId: null },
  { id: "priv1", title: "Private One", author: null, source: null, category: null, difficulty: null, readingMinutes: 3, wordCount: 600, publishedAt: null, heroImage: null, visibility: ArticleVisibility.PRIVATE, status: ArticleStatus.PUBLISHED, ownerId: USER_ID },
  { id: "other1", title: "Theirs", author: null, source: null, category: null, difficulty: null, readingMinutes: 5, wordCount: 900, publishedAt: null, heroImage: null, visibility: ArticleVisibility.PRIVATE, status: ArticleStatus.PUBLISHED, ownerId: OTHER_ID },
  { id: "proc1", title: "Processing", author: null, source: null, category: null, difficulty: null, readingMinutes: null, wordCount: 0, publishedAt: null, heroImage: null, visibility: ArticleVisibility.PRIVATE, status: ArticleStatus.PROCESSING, ownerId: USER_ID },
  { id: "fail1", title: "Failed", author: null, source: null, category: null, difficulty: null, readingMinutes: null, wordCount: 0, publishedAt: null, heroImage: null, visibility: ArticleVisibility.PRIVATE, status: ArticleStatus.FAILED, ownerId: USER_ID },
];

function branchMatches(a: Row, branch: Row): boolean {
  return Object.entries(branch).every(([k, v]) => a[k] === v);
}
function articleMatches(a: Row, where: Row): boolean {
  if (where.id !== undefined && a.id !== where.id) return false;
  if (Array.isArray(where.OR)) {
    return (where.OR as Row[]).some((b) => branchMatches(a, b));
  }
  const { OR: _omit, ...scalars } = where;
  void _omit;
  return branchMatches(a, scalars as Row);
}

let authState: AuthState = "ok";
let sessionRow: Row | null = null;
let updateScopes: { userId: string; localDate: string }[] = [];
let progressTouched = false;

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

const readingProgressSpy = new Proxy(
  {},
  {
    get() {
      return async () => {
        progressTouched = true;
        return null;
      };
    },
  },
);

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => authState),
  });
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
            updateScopes.push({ userId: where.userId, localDate: where.localDate });
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
  authState = "ok";
  sessionRow = makeRow();
  updateScopes = [];
  progressTouched = false;
  process.env[FLAG] = "true";
});

async function POST(body: unknown = {}) {
  const { POST: handler } = (await import("@/app/api/today/set-article/route")) as {
    POST: RouteHandler;
  };
  return handler(jsonPost("http://localhost/api/today/set-article", body));
}

test("returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await POST({ articleId: "pub1" });
  assert.equal(res.status, 401);
});

test("returns 404 when the feature flag is disabled", async () => {
  process.env[FLAG] = "false";
  const res = await POST({ articleId: "pub1" });
  assert.equal(res.status, 404);
  // Nothing written while the kill switch is off.
  assert.equal(sessionRow?.source, "picks");
});

test("rejects a missing article id with 400", async () => {
  const res = await POST({});
  assert.equal(res.status, 400);
  assert.equal(sessionRow?.source, "picks");
});

test("rejects an empty article id with 400", async () => {
  const res = await POST({ articleId: "" });
  assert.equal(res.status, 400);
});

test("IDOR: setting another user's private article returns 404", async () => {
  const res = await POST({ articleId: "other1" });
  assert.equal(res.status, 404);
  assert.equal(sessionRow?.primaryArticleId, "gen1");
  assert.equal(sessionRow?.source, "picks");
});

test("a processing article returns 409 with clear messaging", async () => {
  const res = await POST({ articleId: "proc1" });
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /process/i);
  assert.equal(sessionRow?.source, "picks");
});

test("a failed import returns 409 and is not set", async () => {
  const res = await POST({ articleId: "fail1" });
  assert.equal(res.status, 409);
  assert.equal(sessionRow?.source, "picks");
});

test("sets a readable article as the primary and returns the view model", async () => {
  const res = await POST({ articleId: "pub1", timezone: "UTC" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    source: string;
    primaryArticle: { id: string } | null;
    hasPrimary: boolean;
  };
  assert.equal(body.source, "user_selected");
  assert.equal(body.hasPrimary, true);
  assert.equal(body.primaryArticle?.id, "pub1");
  // Persisted state reflects the override.
  assert.equal(sessionRow?.primaryArticleId, "pub1");
  assert.equal(sessionRow?.source, "user_selected");
  // Replaced generated id retained for analytics/fallback.
  assert.deepEqual(sessionRow?.backupArticleIds, ["b1", "gen1"]);
  // Every write scoped to the authenticated user (never a body id).
  for (const scope of updateScopes) assert.equal(scope.userId, USER_ID);
  // ReadingProgress is never touched by the override.
  assert.equal(progressTouched, false);
});

test("response carries no article content (privacy)", async () => {
  const res = await POST({ articleId: "pub1" });
  assert.equal(res.status, 200);
  const raw = await res.text();
  assert.ok(!/"content"/.test(raw), "response must not include article content");
  assert.ok(!/"ownerId"/.test(raw), "response must not include ownerId");
  assert.ok(!/"visibility"/.test(raw), "response must not include visibility");
});
