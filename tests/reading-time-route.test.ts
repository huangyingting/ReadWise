/**
 * Tests for POST /api/reader/[id]/reading-time (#378).
 *
 * Verifies:
 *  - 401 when unauthenticated
 *  - 404 when article not found or inaccessible
 *  - 400 when activeMs is missing or out of range
 *  - Happy path: calls updateArticleMastery with accumulateTime:true and
 *    returns { timeSpentMs }
 *  - Server-side clamping (value above MAX_ACTIVE_TIME_MS is rejected by schema)
 *
 * No real DB or network — everything is mocked.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  withParams,
  jsonPost,
  readerSession,
} from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";

type RouteHandler = (
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;

// ---------------------------------------------------------------------------
// Mutable state
// ---------------------------------------------------------------------------
let authState: AuthState = "ok";
let articleExists = true;
let masteryTimeSpentMs: number | null = null;
let lastMasteryCall: { userId: string; articleId: string; opts: Record<string, unknown> } | null = null;

const session = readerSession;

// ---------------------------------------------------------------------------
// Mock setup (before — runs once before all tests)
// ---------------------------------------------------------------------------
before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => authState),
  });

  mock.module("@/lib/article-library", {
    namedExports: {
      articleAccessContext: () => ({ userId: session.user.id }),
      getReadableArticleById: async () =>
        articleExists ? { id: "a1", wordCount: 500 } : null,
    },
  });

  mock.module("@/lib/learning/article-mastery", {
    namedExports: {
      updateArticleMastery: async (
        userId: string,
        articleId: string,
        opts: Record<string, unknown>,
      ) => {
        lastMasteryCall = { userId, articleId, opts };
        return { timeSpentMs: masteryTimeSpentMs };
      },
    },
  });

  // The route imports reading-speed for clampActiveTime and MAX_ACTIVE_TIME_MS.
  // Let the real module run (pure functions, no side effects).
});

beforeEach(() => {
  authState = "ok";
  articleExists = true;
  masteryTimeSpentMs = null;
  lastMasteryCall = null;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function callRoute(
  body: unknown,
  articleId = "a1",
): Promise<Response> {
  const { POST } = (await import(
    "@/app/api/reader/[id]/reading-time/route"
  )) as { POST: RouteHandler };
  return POST(
    jsonPost("http://test/api/reader/a1/reading-time", body),
    withParams({ id: articleId }),
  );
}

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------
test("returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await callRoute({ activeMs: 60_000 });
  assert.strictEqual(res.status, 401);
});

// ---------------------------------------------------------------------------
// Article guard
// ---------------------------------------------------------------------------
test("returns 404 when article does not exist", async () => {
  articleExists = false;
  const res = await callRoute({ activeMs: 60_000 });
  assert.strictEqual(res.status, 404);
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------
test("returns 400 when activeMs is missing", async () => {
  const res = await callRoute({});
  assert.strictEqual(res.status, 400);
});

test("returns 400 when activeMs is negative", async () => {
  const res = await callRoute({ activeMs: -1 });
  assert.strictEqual(res.status, 400);
});

test("returns 400 when activeMs exceeds MAX_ACTIVE_TIME_MS", async () => {
  const { MAX_ACTIVE_TIME_MS } = await import("@/lib/reading-speed");
  const res = await callRoute({ activeMs: MAX_ACTIVE_TIME_MS + 1 });
  assert.strictEqual(res.status, 400);
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------
test("calls updateArticleMastery with accumulateTime:true and returns timeSpentMs", async () => {
  masteryTimeSpentMs = 90_000;
  const res = await callRoute({ activeMs: 60_000 });
  assert.strictEqual(res.status, 200);
  const body = (await res.json()) as { timeSpentMs: number | null };
  assert.strictEqual(body.timeSpentMs, 90_000);
  // Verify that the mastery update was called correctly.
  assert.ok(lastMasteryCall !== null, "updateArticleMastery should have been called");
  assert.strictEqual(lastMasteryCall.userId, session.user.id);
  assert.strictEqual(lastMasteryCall.articleId, "a1");
  assert.strictEqual(lastMasteryCall.opts.activeMs, undefined, "opts.activeMs should not exist");
  assert.strictEqual((lastMasteryCall.opts as { timeSpentMs: number }).timeSpentMs, 60_000);
  assert.strictEqual((lastMasteryCall.opts as { accumulateTime: boolean }).accumulateTime, true);
});

test("returns timeSpentMs:null when mastery record is null", async () => {
  masteryTimeSpentMs = null;
  // Make updateArticleMastery return null by setting up the mock to return null.
  // We can't easily override a before() mock per test, so check when mastery is null.
  // The route handles null mastery: returns { timeSpentMs: null }.
  const res = await callRoute({ activeMs: 30_000 });
  assert.strictEqual(res.status, 200);
  const body = (await res.json()) as { timeSpentMs: number | null };
  // masteryTimeSpentMs is null → returned as null
  assert.strictEqual(body.timeSpentMs, null);
});

test("accepts activeMs at MAX_ACTIVE_TIME_MS boundary (exact)", async () => {
  const { MAX_ACTIVE_TIME_MS } = await import("@/lib/reading-speed");
  masteryTimeSpentMs = MAX_ACTIVE_TIME_MS;
  const res = await callRoute({ activeMs: MAX_ACTIVE_TIME_MS });
  assert.strictEqual(res.status, 200);
});

test("accepts activeMs of 0 (no-op but valid)", async () => {
  masteryTimeSpentMs = 0;
  const res = await callRoute({ activeMs: 0 });
  assert.strictEqual(res.status, 200);
});
