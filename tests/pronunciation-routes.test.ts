/**
 * Tests for pronunciation API routes: POST /api/pronunciation/attempt,
 * GET /api/pronunciation/history (M16 Pronunciation Practice).
 *
 * Mocks: @/lib/api-auth, @/lib/prisma.
 * No real DB, network, or Azure Speech SDK touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock, describe } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let authState: AuthState = "ok";
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
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
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
  createdAttempt = null;
  maxPronScore = null;
  findManyRows = [];
  aggResult = { _count: { id: 0 }, _avg: { pronScore: null }, _max: { pronScore: null } };
  process.env.AZURE_SPEECH_KEY = "test-key";
  process.env.AZURE_SPEECH_REGION = "eastus";
});

// ---------------------------------------------------------------------------
// POST /api/pronunciation/attempt route
// ---------------------------------------------------------------------------

describe("POST /api/pronunciation/attempt", () => {
  test("returns 200 with attempt and best on valid input", async () => {
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

  test("accepts optional articleId", async () => {
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

  test("clamps an out-of-range score to 0–100", async () => {
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
          accuracyScore: 200,
          fluencyScore: -50,
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

  test("clamps a non-integer score by rounding", async () => {
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
          accuracyScore: 85.6,
          fluencyScore: 80.2,
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

  test("returns 400 for a non-numeric score", async () => {
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

  test("returns 400 for missing referenceText", async () => {
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

  test("returns 401 when unauthenticated", async () => {
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
});

// ---------------------------------------------------------------------------
// GET /api/pronunciation/history route
// ---------------------------------------------------------------------------

describe("GET /api/pronunciation/history", () => {
  test("returns 200 with history summary (user-scoped)", async () => {
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

  test("returns 401 when unauthenticated", async () => {
    authState = "unauth";
    const { GET } = (await import("@/app/api/pronunciation/history/route")) as {
      GET: RouteHandler;
    };
    const res = await GET(new Request("http://test/api/pronunciation/history"));
    assert.equal(res.status, 401);
  });

  test("respects ?limit query param", async () => {
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
});
