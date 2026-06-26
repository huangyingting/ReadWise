/**
 * Tests for quiz mastery API route handlers (M14).
 *
 * Mocks: @/lib/prisma, @/lib/api-auth, @/lib/quiz.
 * No real DB or network touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock, describe } from "node:test";
import assert from "node:assert/strict";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let authState: AuthState = "ok";
let articleExists = true;

let aggregateResult: { _count: { id: number }; _avg: { scorePct: number | null } } = {
  _count: { id: 0 },
  _avg: { scorePct: null },
};
let maxAggResult: { _max: { scorePct: number | null } } = { _max: { scorePct: null } };
let findManyRows: Record<string, unknown>[] = [];
let groupByRows: { articleId: string; _count: { articleId: number } }[] = [];

type StubQuestion = { question: string; options: string[]; correctIndex: number };
let quizQuestions: StubQuestion[] = [];
let quizFallback = false;

// ---------------------------------------------------------------------------
// Module mocks (registered once before any imports of the modules under test)
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findUnique: async () => (articleExists ? { id: "a1" } : null),
          findFirst: async () => (articleExists ? { id: "a1" } : null),
        },
        quizAttempt: {
          create: async (args: {
            data: Record<string, unknown>;
            select: Record<string, unknown>;
          }) => {
            const data = args.data as {
              userId: string;
              articleId: string;
              correctCount: number;
              totalQuestions: number;
              scorePct: number;
            };
            return {
              id: "attempt-1",
              correctCount: data.correctCount,
              totalQuestions: data.totalQuestions,
              scorePct: data.scorePct,
              completedAt: new Date("2026-01-01T00:00:00Z"),
            };
          },
          aggregate: async (args: { _max?: unknown; _count?: unknown; _avg?: unknown }) => {
            if (args._max) return maxAggResult;
            return aggregateResult;
          },
          findMany: async () => findManyRows,
          groupBy: async () => groupByRows,
        },
      },
    },
  });

  mock.module("@/lib/quiz", {
    namedExports: {
      getOrCreateArticleQuiz: async () => ({
        articleId: "a1",
        questions: quizQuestions,
        fallback: quizFallback,
      }),
    },
  });
});

beforeEach(() => {
  authState = "ok";
  articleExists = true;
  aggregateResult = { _count: { id: 0 }, _avg: { scorePct: null } };
  maxAggResult = { _max: { scorePct: null } };
  findManyRows = [];
  groupByRows = [];
  quizQuestions = [
    { question: "Q1", options: ["a", "b", "c"], correctIndex: 1 },
    { question: "Q2", options: ["a", "b", "c"], correctIndex: 0 },
    { question: "Q3", options: ["a", "b", "c"], correctIndex: 2 },
  ];
  quizFallback = false;
});

// ---------------------------------------------------------------------------
// POST /api/reader/[id]/quiz/attempt
// ---------------------------------------------------------------------------

describe("POST /api/reader/[id]/quiz/attempt", () => {
  test("→ 401 when unauthenticated", async () => {
    authState = "unauth";
    const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
    const res = await POST(
      new Request("http://localhost/api/reader/a1/quiz/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: [
            { index: 0, selectedIndex: 1 },
            { index: 1, selectedIndex: 0 },
            { index: 2, selectedIndex: 2 },
          ],
        }),
      }),
      { params: Promise.resolve({ id: "a1" }) },
    );
    assert.equal(res.status, 401);
  });

  test("→ 404 when article not found", async () => {
    articleExists = false;
    maxAggResult = { _max: { scorePct: null } };
    const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
    const res = await POST(
      new Request("http://localhost/api/reader/missing/quiz/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: [{ index: 0, selectedIndex: 1 }] }),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    assert.equal(res.status, 404);
  });

  test("→ 400 when submitted answer count != cached quiz length", async () => {
    maxAggResult = { _max: { scorePct: null } };
    const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
    const res = await POST(
      new Request("http://localhost/api/reader/a1/quiz/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: [{ index: 0, selectedIndex: 1 }] }),
      }),
      { params: Promise.resolve({ id: "a1" }) },
    );
    assert.equal(res.status, 400);
  });

  test("→ 400 when an unknown question index is submitted", async () => {
    maxAggResult = { _max: { scorePct: null } };
    const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
    const res = await POST(
      new Request("http://localhost/api/reader/a1/quiz/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: [
            { index: 0, selectedIndex: 1 },
            { index: 1, selectedIndex: 0 },
            { index: 9, selectedIndex: 2 },
          ],
        }),
      }),
      { params: Promise.resolve({ id: "a1" }) },
    );
    assert.equal(res.status, 400);
  });

  test("→ 400 when quiz unavailable (fallback)", async () => {
    quizFallback = true;
    quizQuestions = [];
    const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
    const res = await POST(
      new Request("http://localhost/api/reader/a1/quiz/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: [{ index: 0, selectedIndex: 0 }] }),
      }),
      { params: Promise.resolve({ id: "a1" }) },
    );
    assert.equal(res.status, 400);
  });

  test("→ server-grades all-correct answers (scorePct 100)", async () => {
    maxAggResult = { _max: { scorePct: 100 } };
    const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
    const res = await POST(
      new Request("http://localhost/api/reader/a1/quiz/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: [
            { index: 0, selectedIndex: 1 },
            { index: 1, selectedIndex: 0 },
            { index: 2, selectedIndex: 2 },
          ],
        }),
      }),
      { params: Promise.resolve({ id: "a1" }) },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.attempt.correctCount, 3);
    assert.equal(body.attempt.totalQuestions, 3);
    assert.equal(body.attempt.scorePct, 100);
  });

  test("→ a forged high count cannot inflate the score (server-graded)", async () => {
    maxAggResult = { _max: { scorePct: 0 } };
    const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
    const res = await POST(
      new Request("http://localhost/api/reader/a1/quiz/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          correctCount: 3,
          totalQuestions: 3,
          answers: [
            { index: 0, selectedIndex: 0 },
            { index: 1, selectedIndex: 1 },
            { index: 2, selectedIndex: 0 },
          ],
        }),
      }),
      { params: Promise.resolve({ id: "a1" }) },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.attempt.correctCount, 0);
    assert.equal(body.attempt.totalQuestions, 3);
    assert.equal(body.attempt.scorePct, 0);
  });

  test("→ partial answers graded correctly (2/3 → 67%)", async () => {
    maxAggResult = { _max: { scorePct: 67 } };
    const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
    const res = await POST(
      new Request("http://localhost/api/reader/a1/quiz/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: [
            { index: 0, selectedIndex: 1 },
            { index: 1, selectedIndex: 0 },
            { index: 2, selectedIndex: 0 },
          ],
        }),
      }),
      { params: Promise.resolve({ id: "a1" }) },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.attempt.correctCount, 2);
    assert.equal(body.attempt.scorePct, 67);
  });
});

// ---------------------------------------------------------------------------
// GET /api/reader/[id]/quiz/history
// ---------------------------------------------------------------------------

describe("GET /api/reader/[id]/quiz/history", () => {
  test("→ 401 when unauthenticated", async () => {
    authState = "unauth";
    const { GET } = await import("@/app/api/reader/[id]/quiz/history/route");
    const res = await GET(
      new Request("http://localhost/api/reader/a1/quiz/history"),
      { params: Promise.resolve({ id: "a1" }) },
    );
    assert.equal(res.status, 401);
  });

  test("→ 404 when article not found", async () => {
    articleExists = false;
    const { GET } = await import("@/app/api/reader/[id]/quiz/history/route");
    const res = await GET(
      new Request("http://localhost/api/reader/missing/quiz/history"),
      { params: Promise.resolve({ id: "missing" }) },
    );
    assert.equal(res.status, 404);
  });

  test("→ 200 with user's own attempts only", async () => {
    findManyRows = [
      { id: "atmp1", correctCount: 3, totalQuestions: 5, scorePct: 60, completedAt: new Date("2026-01-01") },
    ];
    const { GET } = await import("@/app/api/reader/[id]/quiz/history/route");
    const res = await GET(
      new Request("http://localhost/api/reader/a1/quiz/history"),
      { params: Promise.resolve({ id: "a1" }) },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.attemptCount, 1);
    assert.equal(body.best, 60);
    assert.equal(body.lastScore, 60);
    assert.equal(body.attempts[0].id, "atmp1");
  });
});

// ---------------------------------------------------------------------------
// GET /api/quiz/mastery
// ---------------------------------------------------------------------------

describe("GET /api/quiz/mastery", () => {
  test("→ 401 when unauthenticated", async () => {
    authState = "unauth";
    const { GET } = await import("@/app/api/quiz/mastery/route");
    const res = await GET(new Request("http://localhost/api/quiz/mastery"));
    assert.equal(res.status, 401);
  });

  test("→ 200 with overall mastery for the user", async () => {
    aggregateResult = { _count: { id: 3 }, _avg: { scorePct: 66.67 } };
    groupByRows = [{ articleId: "a1", _count: { articleId: 3 } }];
    findManyRows = [
      { completedAt: new Date("2026-01-03"), scorePct: 80 },
      { completedAt: new Date("2026-01-02"), scorePct: 60 },
      { completedAt: new Date("2026-01-01"), scorePct: 60 },
    ];
    const { GET } = await import("@/app/api/quiz/mastery/route");
    const res = await GET(new Request("http://localhost/api/quiz/mastery"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.totalAttempts, 3);
    assert.equal(body.articlesQuizzed, 1);
    assert.equal(body.averageScore, 67);
    assert.equal(body.recentTrend.length, 3);
    assert.equal(body.recentTrend[0].scorePct, 60);
    assert.equal(body.recentTrend[2].scorePct, 80);
  });
});
