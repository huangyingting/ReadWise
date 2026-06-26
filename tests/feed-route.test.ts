/**
 * Route tests for GET /api/feed (M15 personalized feed endpoint).
 * Mocks @/lib/api-auth and @/lib/feed so no DB or scoring logic is exercised.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

// ---- mutable state --------------------------------------------------------

let authState: AuthState = "ok";

type FeedResult = {
  articles: { id: string; title: string; author: string | null; source: string | null; category: string | null; difficulty: string | null; readingMinutes: number | null }[];
  hasMore: boolean;
  reasons: Record<string, string>;
};

let feedResult: FeedResult = {
  articles: [{ id: "a1", title: "Test", author: null, source: null, category: "tech", difficulty: "B1", readingMinutes: 3 }],
  hasMore: false,
  reasons: { "a1": "Matches your interest in Tech" },
};
let progressResult: Record<string, { percent: number; completed: boolean }> = {};

// ---- mocks ----------------------------------------------------------------

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  mock.module("@/lib/feed", {
    namedExports: {
      getPersonalizedFeed: async () => feedResult,
      FEED_PAGE_SIZE: 10,
      FEED_MAX_LIMIT: 24,
    },
  });

  mock.module("@/lib/engagement/progress", {
    namedExports: {
      getProgressSummaries: async () => progressResult,
    },
  });
});

beforeEach(() => {
  authState = "ok";
  feedResult = {
    articles: [{ id: "a1", title: "Test", author: null, source: null, category: "tech", difficulty: "B1", readingMinutes: 3 }],
    hasMore: false,
    reasons: { "a1": "Matches your interest in Tech" },
  };
  progressResult = {};
});

// ---- tests ----------------------------------------------------------------

test("GET /api/feed returns articles + progress + reasons + hasMore + offset", async () => {
  progressResult = { "a1": { percent: 20, completed: false } };
  const { GET } = (await import("@/app/api/feed/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/feed"), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.articles), "articles is array");
  assert.equal(body.articles.length, 1);
  assert.equal(body.articles[0].id, "a1");
  assert.deepEqual(body.progress, { "a1": { percent: 20, completed: false } });
  assert.equal(body.hasMore, false);
  assert.equal(body.offset, 1);
  assert.ok(body.reasons && typeof body.reasons === "object", "reasons map present");
  assert.equal(body.reasons["a1"], "Matches your interest in Tech");
  assert.ok(res.headers.get("x-request-id"), "x-request-id header present");
});

test("GET /api/feed returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { GET } = (await import("@/app/api/feed/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/feed"), undefined);
  assert.equal(res.status, 401);
});

test("GET /api/feed respects offset and limit query params", async () => {
  feedResult = { articles: [], hasMore: true, reasons: {} };
  const { GET } = (await import("@/app/api/feed/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/feed?offset=10&limit=5"), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.offset, 10); // offset(10) + articles.length(0)
  assert.equal(body.hasMore, true);
});

test("GET /api/feed returns empty articles array gracefully", async () => {
  feedResult = { articles: [], hasMore: false, reasons: {} };
  const { GET } = (await import("@/app/api/feed/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/feed"), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.articles, []);
  assert.equal(body.hasMore, false);
});
