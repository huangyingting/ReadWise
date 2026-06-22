/**
 * Tests for M16 Pronunciation Practice: speech token endpoint, lib helpers,
 * and pronunciation attempt/history API routes.
 *
 * Mocks: @/lib/api-auth, @/lib/speech, @/lib/prisma, globalThis.fetch.
 * No real DB, network, or Azure Speech SDK is touched.
 */
process.env.LOG_LEVEL = "error"; // silence request logs

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let authState: "ok" | "unauth" = "ok";
const session = { user: { id: "user-1", role: "Reader", name: "T", email: "t@e.com" } };

// Speech config mock
let speechConfigured = true;

// fetch mock state (for issueToken call)
let mockFetchShouldThrow = false;
let mockFetchStatus = 200;
const MOCK_TOKEN = "azure-token-xyz";

// prisma.pronunciationAttempt stubs
let createdAttempt: Record<string, unknown> | null = null;
let maxPronScore: number | null = null;
let findManyRows: Record<string, unknown>[] = [];
let aggResult: {
  _count: { id: number };
  _avg: { pronScore: number | null };
  _max: { pronScore: number | null };
} = { _count: { id: 0 }, _avg: { pronScore: null }, _max: { pronScore: null } };

// ---------------------------------------------------------------------------
// Module mocks — registered once before any module-under-test is imported
// ---------------------------------------------------------------------------

before(() => {
  // Mock global fetch BEFORE any module that calls it is imported.
  globalThis.fetch = (async (
    _input: RequestInfo | URL,
    _init?: RequestInit,
  ): Promise<Response> => {
    if (mockFetchShouldThrow) throw new Error("Network failure");
    return new Response(mockFetchStatus === 200 ? MOCK_TOKEN : "error", {
      status: mockFetchStatus,
    });
  }) as typeof fetch;

  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () =>
        authState === "unauth"
          ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
          : { session },
      requireAdminApi: async () =>
        authState === "unauth"
          ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
          : { session },
    },
  });

  mock.module("@/lib/speech", {
    namedExports: {
      isSpeechConfigured: () => speechConfigured,
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        pronunciationAttempt: {
          create: async (args: { data: Record<string, unknown> }) => {
            const d = args.data;
            createdAttempt = {
              id: "pa-1",
              referenceText: d.referenceText,
              accuracyScore: d.accuracyScore,
              fluencyScore: d.fluencyScore,
              completenessScore: d.completenessScore,
              pronScore: d.pronScore,
              articleId: d.articleId ?? null,
              createdAt: new Date("2026-01-01T00:00:00Z"),
            };
            return createdAttempt;
          },
          aggregate: async (args: Record<string, unknown>) => {
            // getPronunciationHistory includes _count; recordPronunciationAttempt only uses _max
            if ("_count" in args) {
              return {
                _count: { id: aggResult._count.id },
                _avg: { pronScore: aggResult._avg.pronScore },
                _max: { pronScore: aggResult._max.pronScore },
              };
            }
            return { _max: { pronScore: maxPronScore } };
          },
          findMany: async () => findManyRows,
        },
        // article.findUnique/findFirst is used by getViewableArticleById in the attempt route.
        // Return a stub published article for any id to satisfy the existence check.
        article: {
          findUnique: async (args: { where: { id: string; status?: string } }) => {
            if (args.where.id) {
              return { id: args.where.id, status: "published", ownerId: null };
            }
            return null;
          },
          findFirst: async (args: { where: { id: string } }) => {
            if (args.where.id) {
              return { id: args.where.id, status: "published", ownerId: null };
            }
            return null;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  speechConfigured = true;
  mockFetchShouldThrow = false;
  mockFetchStatus = 200;
  createdAttempt = null;
  maxPronScore = null;
  findManyRows = [];
  aggResult = { _count: { id: 0 }, _avg: { pronScore: null }, _max: { pronScore: null } };
  // Provide env vars so configured-path reads don't get undefined.
  process.env.AZURE_SPEECH_KEY = "test-key";
  process.env.AZURE_SPEECH_REGION = "eastus";
});

// ---------------------------------------------------------------------------
// GET /api/speech/token — token endpoint
// ---------------------------------------------------------------------------

test("GET /speech/token returns configured:false when Speech unconfigured", async () => {
  speechConfigured = false;
  const { GET } = (await import("@/app/api/speech/token/route")) as {
    GET: RouteHandler;
  };
  const res = await GET(new Request("http://test/api/speech/token"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.configured, false);
  assert.ok(!("token" in body), "key must not be exposed");
});

test("GET /speech/token returns {configured:true, token, region} on success", async () => {
  const { GET } = (await import("@/app/api/speech/token/route")) as {
    GET: RouteHandler;
  };
  const res = await GET(new Request("http://test/api/speech/token"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.configured, true);
  assert.equal(body.token, MOCK_TOKEN);
  assert.equal(body.region, "eastus");
  assert.ok(!("key" in body), "AZURE_SPEECH_KEY must never be sent");
});

test("GET /speech/token returns 502 with {configured:true, error} when issueToken call fails (non-2xx)", async () => {
  mockFetchStatus = 401;
  const { GET } = (await import("@/app/api/speech/token/route")) as {
    GET: RouteHandler;
  };
  const res = await GET(new Request("http://test/api/speech/token"));
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.configured, true);
  assert.ok("error" in body);
});

test("GET /speech/token returns 502 when fetch throws (network error)", async () => {
  mockFetchShouldThrow = true;
  const { GET } = (await import("@/app/api/speech/token/route")) as {
    GET: RouteHandler;
  };
  const res = await GET(new Request("http://test/api/speech/token"));
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.configured, true);
  assert.ok("error" in body);
});

test("GET /speech/token returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { GET } = (await import("@/app/api/speech/token/route")) as {
    GET: RouteHandler;
  };
  const res = await GET(new Request("http://test/api/speech/token"));
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// recordPronunciationAttempt lib
// ---------------------------------------------------------------------------

test("recordPronunciationAttempt records attempt and returns best pronScore", async () => {
  maxPronScore = 85;
  const { recordPronunciationAttempt } = await import("@/lib/pronunciation");
  const result = await recordPronunciationAttempt("user-1", {
    referenceText: "The quick brown fox",
    accuracyScore: 80,
    fluencyScore: 75,
    completenessScore: 90,
    pronScore: 85,
  });
  assert.ok(result.attempt.id);
  assert.equal(result.attempt.accuracyScore, 80);
  assert.equal(result.attempt.pronScore, 85);
  assert.equal(result.best, 85);
});

test("recordPronunciationAttempt stores optional articleId", async () => {
  maxPronScore = 70;
  const { recordPronunciationAttempt } = await import("@/lib/pronunciation");
  const result = await recordPronunciationAttempt("user-1", {
    referenceText: "Hello world",
    accuracyScore: 70,
    fluencyScore: 65,
    completenessScore: 80,
    pronScore: 70,
    articleId: "article-42",
  });
  assert.equal(result.attempt.articleId, "article-42");
});

test("recordPronunciationAttempt throws on empty referenceText", async () => {
  const { recordPronunciationAttempt } = await import("@/lib/pronunciation");
  await assert.rejects(
    () =>
      recordPronunciationAttempt("user-1", {
        referenceText: "   ",
        accuracyScore: 80,
        fluencyScore: 75,
        completenessScore: 90,
        pronScore: 85,
      }),
    /referenceText/,
  );
});

test("recordPronunciationAttempt throws on score > 100", async () => {
  const { recordPronunciationAttempt } = await import("@/lib/pronunciation");
  await assert.rejects(
    () =>
      recordPronunciationAttempt("user-1", {
        referenceText: "Hello",
        accuracyScore: 150,
        fluencyScore: 75,
        completenessScore: 90,
        pronScore: 85,
      }),
    /accuracyScore/,
  );
});

test("recordPronunciationAttempt throws on negative score", async () => {
  const { recordPronunciationAttempt } = await import("@/lib/pronunciation");
  await assert.rejects(
    () =>
      recordPronunciationAttempt("user-1", {
        referenceText: "Hello",
        accuracyScore: 80,
        fluencyScore: -5,
        completenessScore: 90,
        pronScore: 85,
      }),
    /fluencyScore/,
  );
});

test("recordPronunciationAttempt throws on non-integer score", async () => {
  const { recordPronunciationAttempt } = await import("@/lib/pronunciation");
  await assert.rejects(
    () =>
      recordPronunciationAttempt("user-1", {
        referenceText: "Hello",
        accuracyScore: 80,
        fluencyScore: 75,
        completenessScore: 90,
        pronScore: 85.5,
      }),
    /pronScore/,
  );
});

// ---------------------------------------------------------------------------
// getPronunciationHistory lib
// ---------------------------------------------------------------------------

test("getPronunciationHistory returns summary with attempts and stats", async () => {
  findManyRows = [
    {
      id: "pa-1",
      referenceText: "Hello world",
      accuracyScore: 80,
      fluencyScore: 70,
      completenessScore: 90,
      pronScore: 80,
      articleId: null,
      createdAt: new Date("2026-01-01"),
    },
  ];
  aggResult = { _count: { id: 1 }, _avg: { pronScore: 80 }, _max: { pronScore: 80 } };
  const { getPronunciationHistory } = await import("@/lib/pronunciation");
  const history = await getPronunciationHistory("user-1");
  assert.equal(history.attemptCount, 1);
  assert.equal(history.bestPronScore, 80);
  assert.equal(history.averageScore, 80);
  assert.equal(history.attempts.length, 1);
  assert.equal(history.attempts[0].id, "pa-1");
});

test("getPronunciationHistory returns nulls for best/average when no attempts", async () => {
  findManyRows = [];
  aggResult = { _count: { id: 0 }, _avg: { pronScore: null }, _max: { pronScore: null } };
  const { getPronunciationHistory } = await import("@/lib/pronunciation");
  const history = await getPronunciationHistory("user-1");
  assert.equal(history.attemptCount, 0);
  assert.equal(history.bestPronScore, null);
  assert.equal(history.averageScore, null);
  assert.deepEqual(history.attempts, []);
});

test("getPronunciationHistory rounds averageScore", async () => {
  findManyRows = [];
  aggResult = { _count: { id: 3 }, _avg: { pronScore: 76.67 }, _max: { pronScore: 85 } };
  const { getPronunciationHistory } = await import("@/lib/pronunciation");
  const history = await getPronunciationHistory("user-1");
  assert.equal(history.averageScore, 77); // Math.round(76.67)
  assert.equal(history.bestPronScore, 85);
});

// ---------------------------------------------------------------------------
// POST /api/pronunciation/attempt route
// ---------------------------------------------------------------------------

test("POST /pronunciation/attempt returns 200 with attempt and best on valid input", async () => {
  maxPronScore = 90;
  const { POST } = (await import("@/app/api/pronunciation/attempt/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    new Request("http://test/api/pronunciation/attempt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        referenceText: "The quick brown fox jumps",
        accuracyScore: 85,
        fluencyScore: 80,
        completenessScore: 95,
        pronScore: 90,
      }),
    }),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok("attempt" in body);
  assert.ok("best" in body);
  assert.equal(body.best, 90);
  assert.equal(body.attempt.accuracyScore, 85);
});

test("POST /pronunciation/attempt accepts optional articleId", async () => {
  maxPronScore = 75;
  const { POST } = (await import("@/app/api/pronunciation/attempt/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    new Request("http://test/api/pronunciation/attempt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        referenceText: "Hello",
        accuracyScore: 75,
        fluencyScore: 70,
        completenessScore: 80,
        pronScore: 75,
        articleId: "article-1",
      }),
    }),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.attempt.articleId, "article-1");
});

test("POST /pronunciation/attempt clamps an out-of-range score to 0–100", async () => {
  // The score is client-derived; the endpoint CLAMPS rather than rejecting so a
  // forged/over-range value (200) is bounded to 100 instead of corrupting stats.
  maxPronScore = 100;
  const { POST } = (await import("@/app/api/pronunciation/attempt/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    new Request("http://test/api/pronunciation/attempt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        referenceText: "Hello",
        accuracyScore: 200, // → clamped to 100
        fluencyScore: -50, // → clamped to 0
        completenessScore: 95,
        pronScore: 90,
      }),
    }),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.attempt.accuracyScore, 100);
  assert.equal(body.attempt.fluencyScore, 0);
  assert.equal(body.attempt.completenessScore, 95);
  assert.equal(body.attempt.pronScore, 90);
});

test("POST /pronunciation/attempt clamps a non-integer score by rounding", async () => {
  maxPronScore = 86;
  const { POST } = (await import("@/app/api/pronunciation/attempt/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    new Request("http://test/api/pronunciation/attempt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        referenceText: "Hello",
        accuracyScore: 85.6, // → rounded to 86
        fluencyScore: 80.2, // → rounded to 80
        completenessScore: 95,
        pronScore: 86,
      }),
    }),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.attempt.accuracyScore, 86);
  assert.equal(body.attempt.fluencyScore, 80);
});

test("POST /pronunciation/attempt returns 400 for a non-numeric score", async () => {
  const { POST } = (await import("@/app/api/pronunciation/attempt/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    new Request("http://test/api/pronunciation/attempt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        referenceText: "Hello",
        accuracyScore: "not-a-number",
        fluencyScore: 80,
        completenessScore: 95,
        pronScore: 90,
      }),
    }),
  );
  assert.equal(res.status, 400);
});

test("POST /pronunciation/attempt returns 400 for missing referenceText", async () => {
  const { POST } = (await import("@/app/api/pronunciation/attempt/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    new Request("http://test/api/pronunciation/attempt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accuracyScore: 80,
        fluencyScore: 75,
        completenessScore: 90,
        pronScore: 85,
      }),
    }),
  );
  assert.equal(res.status, 400);
});

test("POST /pronunciation/attempt returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { POST } = (await import("@/app/api/pronunciation/attempt/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    new Request("http://test/api/pronunciation/attempt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        referenceText: "Hello",
        accuracyScore: 80,
        fluencyScore: 75,
        completenessScore: 90,
        pronScore: 85,
      }),
    }),
  );
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// GET /api/pronunciation/history route
// ---------------------------------------------------------------------------

test("GET /pronunciation/history returns 200 with history summary (user-scoped)", async () => {
  findManyRows = [
    {
      id: "pa-2",
      referenceText: "Hi there",
      accuracyScore: 70,
      fluencyScore: 65,
      completenessScore: 80,
      pronScore: 70,
      articleId: null,
      createdAt: new Date("2026-01-01"),
    },
  ];
  aggResult = { _count: { id: 1 }, _avg: { pronScore: 70 }, _max: { pronScore: 70 } };
  const { GET } = (await import("@/app/api/pronunciation/history/route")) as {
    GET: RouteHandler;
  };
  const res = await GET(new Request("http://test/api/pronunciation/history"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.attemptCount, 1);
  assert.equal(body.bestPronScore, 70);
  assert.equal(body.averageScore, 70);
  assert.equal(body.attempts.length, 1);
  assert.equal(body.attempts[0].id, "pa-2");
});

test("GET /pronunciation/history returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { GET } = (await import("@/app/api/pronunciation/history/route")) as {
    GET: RouteHandler;
  };
  const res = await GET(new Request("http://test/api/pronunciation/history"));
  assert.equal(res.status, 401);
});

test("GET /pronunciation/history respects ?limit query param", async () => {
  findManyRows = [];
  aggResult = { _count: { id: 0 }, _avg: { pronScore: null }, _max: { pronScore: null } };
  const { GET } = (await import("@/app/api/pronunciation/history/route")) as {
    GET: RouteHandler;
  };
  const res = await GET(
    new Request("http://test/api/pronunciation/history?limit=5"),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.attemptCount, 0);
});
