/**
 * Route tests for GET /api/today (#797).
 *
 * The summary route returns the authenticated learner's privacy-safe Today view
 * model. Verifies auth, the feature-flag 404, user scoping (the session id is
 * always used), readable-id resolution, and the no-leak payload. Mocks auth +
 * prisma; the existing session short-circuits generation so no Picks feed runs.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, getReq } from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";

type Row = Record<string, unknown>;

let authState: AuthState = "ok";
let sessionRow: Row | null = null;
const USER_ID = "user-1";
// Anchored to the current UTC day so the pre-seeded Today session matches the
// localDate the route/generator resolves from `new Date()` (avoids date-rollover
// flakiness). Format matches dateKey(now, "UTC").
const LOCAL_DATE = new Date().toISOString().slice(0, 10);
const FLAG = "FEATURE_TODAY_SESSION_ENABLED";

function makeRow(overrides: Row = {}): Row {
  return {
    id: "ts1",
    userId: USER_ID,
    localDate: LOCAL_DATE,
    timezoneSnapshot: "UTC",
    primaryArticleId: "a1",
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

let articleQueries: unknown[] = [];
let sessionLookups: { userId: string; localDate: string }[] = [];

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
        todaySession: {
          findUnique: async ({
            where,
          }: {
            where: { userId_localDate: { userId: string; localDate: string } };
          }) => {
            const k = where.userId_localDate;
            sessionLookups.push({ ...k });
            if (!sessionRow) return null;
            return sessionRow.userId === k.userId && sessionRow.localDate === k.localDate
              ? { ...sessionRow }
              : null;
          },
        },
        article: {
          findFirst: async (args: { where: { AND?: unknown } }) => {
            articleQueries.push(args);
            // Resolve only "a1" and "b1" as readable; anything else is null.
            const json = JSON.stringify(args.where ?? {});
            const id = json.includes("\"a1\"") ? "a1" : json.includes("\"b1\"") ? "b1" : null;
            if (!id) return null;
            return {
              id,
              title: `Title ${id}`,
              author: null,
              source: null,
              category: "tech",
              difficulty: "B1",
              readingMinutes: 4,
              wordCount: 400,
              publishedAt: new Date("2026-06-26T00:00:00Z"),
              heroImage: null,
            };
          },
        },
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  sessionRow = makeRow();
  articleQueries = [];
  sessionLookups = [];
  process.env[FLAG] = "true";
});

afterEach(() => {
  process.env[FLAG] = "true";
});

async function GET(url = "http://localhost/api/today") {
  const { GET: handler } = (await import("@/app/api/today/route")) as {
    GET: RouteHandler;
  };
  return handler(getReq(url));
}

test("returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await GET();
  assert.equal(res.status, 401);
});

test("returns 404 when the feature flag is disabled", async () => {
  process.env[FLAG] = "false";
  const res = await GET();
  assert.equal(res.status, 404);
});

test("returns the privacy-safe Today view model for the session user", async () => {
  const res = await GET();
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.localDate, LOCAL_DATE);
  assert.equal(body.status, "active");
  assert.equal((body.cta as { kind: string }).kind, "start");
  assert.equal((body.primaryArticle as { id: string }).id, "a1");
  assert.deepEqual((body.backups as { id: string }[]).map((b) => b.id), ["b1"]);
  // No content-bearing fields leak.
  const json = JSON.stringify(body);
  for (const forbidden of ["content", "definition", "explanation", "contextSentence"]) {
    assert.ok(!json.includes(forbidden), `payload leaked ${forbidden}`);
  }
});

test("scopes the session lookup to the authenticated session id (not a body id)", async () => {
  const res = await GET();
  assert.equal(res.status, 200);
  // Every Today session lookup used the authenticated user's id.
  assert.ok(sessionLookups.length > 0);
  for (const lookup of sessionLookups) {
    assert.equal(lookup.userId, USER_ID);
  }
});

test("ignores an over-long timezone query with 400", async () => {
  const longTz = "x".repeat(101);
  const res = await GET(`http://localhost/api/today?timezone=${longTz}`);
  assert.equal(res.status, 400);
});
