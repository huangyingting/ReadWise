/**
 * Tests for quiz mastery lib and API endpoints (M14).
 *
 * Mocks: @/lib/prisma, @/lib/api-auth.
 * No real DB or network touched.
 */
process.env.LOG_LEVEL = "error"; // silence request logs

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let authState: "ok" | "unauth" = "ok";
const session = { user: { id: "user-1", role: "Reader", name: "T", email: "t@e.com" } };

// prisma.article stub
let articleExists = true;

// prisma.quizAttempt stubs
let createdAttempt: Record<string, unknown> | null = null;
let aggregateResult: { _count: { id: number }; _avg: { scorePct: number | null } } = {
  _count: { id: 0 },
  _avg: { scorePct: null },
};
let maxAggResult: { _max: { scorePct: number | null } } = { _max: { scorePct: null } };
let findManyRows: Record<string, unknown>[] = [];
let groupByRows: { articleId: string; _count: { articleId: number } }[] = [];

// @/lib/quiz stub (getOrCreateArticleQuiz) — controls the cached questions the
// route grades against.
type StubQuestion = { question: string; options: string[]; correctIndex: number };
let quizQuestions: StubQuestion[] = [];
let quizFallback = false;

// ---------------------------------------------------------------------------
// Module mocks (registered once before any imports of the modules under test)
// ---------------------------------------------------------------------------

before(() => {
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

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findUnique: async () => (articleExists ? { id: "a1" } : null),
          findFirst: async () => (articleExists ? { id: "a1" } : null),
        },        quizAttempt: {
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
            createdAttempt = {
              id: "attempt-1",
              correctCount: data.correctCount,
              totalQuestions: data.totalQuestions,
              scorePct: data.scorePct,
              completedAt: new Date("2026-01-01T00:00:00Z"),
            };
            return createdAttempt;
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
  createdAttempt = null;
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
// recordQuizAttempt
// ---------------------------------------------------------------------------

test("recordQuizAttempt computes scorePct correctly and returns best", async () => {
  maxAggResult = { _max: { scorePct: 80 } };
  const { recordQuizAttempt } = await import("@/lib/learning/quiz-mastery");
  const { attempt, best } = await recordQuizAttempt("user-1", "a1", 4, 5);
  assert.equal(attempt.scorePct, 80); // round(4/5*100) = 80
  assert.equal(attempt.correctCount, 4);
  assert.equal(attempt.totalQuestions, 5);
  assert.equal(best, 80);
});

test("recordQuizAttempt: 0 correct → scorePct 0", async () => {
  maxAggResult = { _max: { scorePct: 0 } };
  const { recordQuizAttempt } = await import("@/lib/learning/quiz-mastery");
  const { attempt } = await recordQuizAttempt("user-1", "a1", 0, 5);
  assert.equal(attempt.scorePct, 0);
});

test("recordQuizAttempt: all correct → scorePct 100", async () => {
  maxAggResult = { _max: { scorePct: 100 } };
  const { recordQuizAttempt } = await import("@/lib/learning/quiz-mastery");
  const { attempt } = await recordQuizAttempt("user-1", "a1", 5, 5);
  assert.equal(attempt.scorePct, 100);
});

test("recordQuizAttempt throws on totalQuestions = 0", async () => {
  const { recordQuizAttempt } = await import("@/lib/learning/quiz-mastery");
  await assert.rejects(() => recordQuizAttempt("user-1", "a1", 0, 0), /totalQuestions/);
});

test("recordQuizAttempt throws when correctCount > totalQuestions", async () => {
  const { recordQuizAttempt } = await import("@/lib/learning/quiz-mastery");
  await assert.rejects(() => recordQuizAttempt("user-1", "a1", 6, 5), /correctCount/);
});

test("recordQuizAttempt throws on negative correctCount", async () => {
  const { recordQuizAttempt } = await import("@/lib/learning/quiz-mastery");
  await assert.rejects(() => recordQuizAttempt("user-1", "a1", -1, 5), /correctCount/);
});

// ---------------------------------------------------------------------------
// getArticleQuizHistory
// ---------------------------------------------------------------------------

test("getArticleQuizHistory returns attempts newest-first, computes best/last/count", async () => {
  findManyRows = [
    { id: "a2", correctCount: 4, totalQuestions: 5, scorePct: 80, completedAt: new Date("2026-02-01") },
    { id: "a1", correctCount: 3, totalQuestions: 5, scorePct: 60, completedAt: new Date("2026-01-01") },
  ];
  const { getArticleQuizHistory } = await import("@/lib/learning/quiz-mastery");
  const history = await getArticleQuizHistory("user-1", "a1");
  assert.equal(history.attemptCount, 2);
  assert.equal(history.best, 80);
  assert.equal(history.lastScore, 80); // first in newest-first list
  assert.equal(history.attempts[0].id, "a2");
});

test("getArticleQuizHistory returns nulls when no attempts exist", async () => {
  findManyRows = [];
  const { getArticleQuizHistory } = await import("@/lib/learning/quiz-mastery");
  const history = await getArticleQuizHistory("user-1", "no-attempts");
  assert.equal(history.best, null);
  assert.equal(history.lastScore, null);
  assert.equal(history.attemptCount, 0);
  assert.deepEqual(history.attempts, []);
});

// ---------------------------------------------------------------------------
// getQuizMastery
// ---------------------------------------------------------------------------

test("getQuizMastery aggregates correctly", async () => {
  aggregateResult = { _count: { id: 5 }, _avg: { scorePct: 74.6 } };
  groupByRows = [
    { articleId: "a1", _count: { articleId: 3 } },
    { articleId: "a2", _count: { articleId: 2 } },
  ];
  findManyRows = [
    { completedAt: new Date("2026-01-03"), scorePct: 70 },
    { completedAt: new Date("2026-01-02"), scorePct: 80 },
    { completedAt: new Date("2026-01-01"), scorePct: 60 },
  ];
  const { getQuizMastery } = await import("@/lib/learning/quiz-mastery");
  const mastery = await getQuizMastery("user-1");
  assert.equal(mastery.totalAttempts, 5);
  assert.equal(mastery.articlesQuizzed, 2);
  assert.equal(mastery.averageScore, 75); // Math.round(74.6)
  // trend is reversed to oldest→newest
  assert.equal(mastery.recentTrend.length, 3);
  assert.equal(mastery.recentTrend[0].scorePct, 60); // oldest first
  assert.equal(mastery.recentTrend[2].scorePct, 70); // newest last
});

test("getQuizMastery returns null averageScore when no attempts", async () => {
  aggregateResult = { _count: { id: 0 }, _avg: { scorePct: null } };
  groupByRows = [];
  findManyRows = [];
  const { getQuizMastery } = await import("@/lib/learning/quiz-mastery");
  const mastery = await getQuizMastery("user-1");
  assert.equal(mastery.totalAttempts, 0);
  assert.equal(mastery.articlesQuizzed, 0);
  assert.equal(mastery.averageScore, null);
  assert.deepEqual(mastery.recentTrend, []);
});

// ---------------------------------------------------------------------------
// POST /api/reader/[id]/quiz/attempt  route tests
// ---------------------------------------------------------------------------

test("POST /attempt → 401 when unauthenticated", async () => {
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

test("POST /attempt → 404 when article not found", async () => {
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

test("POST /attempt → 400 when submitted answer count != cached quiz length", async () => {
  maxAggResult = { _max: { scorePct: null } };
  const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
  // Cached quiz has 3 questions; submit only 1.
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

test("POST /attempt → 400 when an unknown question index is submitted", async () => {
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
          { index: 9, selectedIndex: 2 }, // out of range
        ],
      }),
    }),
    { params: Promise.resolve({ id: "a1" }) },
  );
  assert.equal(res.status, 400);
});

test("POST /attempt → 400 when quiz unavailable (fallback)", async () => {
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

test("POST /attempt → server-grades all-correct answers (scorePct 100)", async () => {
  maxAggResult = { _max: { scorePct: 100 } };
  const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
  // correctIndex are [1, 0, 2] — submit all correct.
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

test("POST /attempt → a forged high count cannot inflate the score (server-graded)", async () => {
  // Client smuggles correctCount/totalQuestions; unknown keys are DROPPED, and
  // the actual answers are all wrong → server grades 0, not the forged value.
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
          { index: 0, selectedIndex: 0 }, // wrong (correct=1)
          { index: 1, selectedIndex: 1 }, // wrong (correct=0)
          { index: 2, selectedIndex: 0 }, // wrong (correct=2)
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

test("POST /attempt → partial answers graded correctly (2/3 → 67%)", async () => {
  maxAggResult = { _max: { scorePct: 67 } };
  const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
  const res = await POST(
    new Request("http://localhost/api/reader/a1/quiz/attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: [
          { index: 0, selectedIndex: 1 }, // correct
          { index: 1, selectedIndex: 0 }, // correct
          { index: 2, selectedIndex: 0 }, // wrong (correct=2)
        ],
      }),
    }),
    { params: Promise.resolve({ id: "a1" }) },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.attempt.correctCount, 2);
  assert.equal(body.attempt.scorePct, 67); // round(2/3*100)
});

// ---------------------------------------------------------------------------
// GET /api/reader/[id]/quiz/history  route tests
// ---------------------------------------------------------------------------

test("GET /history → 401 when unauthenticated", async () => {
  authState = "unauth";
  const { GET } = await import("@/app/api/reader/[id]/quiz/history/route");
  const res = await GET(
    new Request("http://localhost/api/reader/a1/quiz/history"),
    { params: Promise.resolve({ id: "a1" }) },
  );
  assert.equal(res.status, 401);
});

test("GET /history → 404 when article not found", async () => {
  articleExists = false;
  const { GET } = await import("@/app/api/reader/[id]/quiz/history/route");
  const res = await GET(
    new Request("http://localhost/api/reader/missing/quiz/history"),
    { params: Promise.resolve({ id: "missing" }) },
  );
  assert.equal(res.status, 404);
});

test("GET /history → 200 with user's own attempts only", async () => {
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

// ---------------------------------------------------------------------------
// GET /api/quiz/mastery  route tests
// ---------------------------------------------------------------------------

test("GET /mastery → 401 when unauthenticated", async () => {
  authState = "unauth";
  const { GET } = await import("@/app/api/quiz/mastery/route");
  const res = await GET(new Request("http://localhost/api/quiz/mastery"));
  assert.equal(res.status, 401);
});

test("GET /mastery → 200 with overall mastery for the user", async () => {
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
  assert.equal(body.averageScore, 67); // Math.round(66.67)
  assert.equal(body.recentTrend.length, 3);
  // oldest first
  assert.equal(body.recentTrend[0].scorePct, 60);
  assert.equal(body.recentTrend[2].scorePct, 80);
});
