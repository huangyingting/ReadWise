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
type SubmittedAnswer = { index: number; selectedIndex: number };
type QuizRouteContext = { params: Promise<{ id: string }> };

const ALL_CORRECT_ANSWERS: SubmittedAnswer[] = [
  { index: 0, selectedIndex: 1 },
  { index: 1, selectedIndex: 0 },
  { index: 2, selectedIndex: 2 },
];

let quizQuestions: StubQuestion[] = [];
let quizFallback = false;
let quizAttemptCreateError: Error | null = null;
let existingQuizAttempt: Record<string, unknown> | null = null;
let quizAttemptCreateCount = 0;
let articleMasteryUpdates = 0;
let learnerEvidenceWrites = 0;
let quizAnalyticsEvents = 0;
let todayCompletions = 0;
let lastTodayCompletion:
  | {
      userId: string;
      articleId: string;
      requestTimezone?: string | null;
      localDate?: string | null;
    }
  | undefined;
let assignmentCompletions = 0;

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
        membership: { findMany: async () => [] },
        quizAttempt: {
          findUnique: async () => existingQuizAttempt,
          create: async (args: {
            data: Record<string, unknown>;
            select: Record<string, unknown>;
          }) => {
            if (quizAttemptCreateError) throw quizAttemptCreateError;
            quizAttemptCreateCount += 1;
            const data = args.data as {
              userId: string;
              articleId: string;
              correctCount: number;
              totalQuestions: number;
              scorePct: number;
              clientMutationId?: string | null;
            };
            const created = {
              id: "attempt-1",
              userId: data.userId,
              articleId: data.articleId,
              correctCount: data.correctCount,
              totalQuestions: data.totalQuestions,
              scorePct: data.scorePct,
              completedAt: new Date("2026-01-01T00:00:00Z"),
            };
            if (data.clientMutationId) existingQuizAttempt = created;
            return created;
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

  mock.module("@/lib/learning/article-mastery", {
    namedExports: {
      updateArticleMastery: async () => {
        articleMasteryUpdates += 1;
      },
    },
  });
  mock.module("@/lib/learning/learner-evidence", {
    namedExports: {
      recordLearnerEvidence: async () => {
        learnerEvidenceWrites += 1;
      },
    },
  });
  mock.module("@/lib/analytics/events", {
    namedExports: {
      ANALYTICS_EVENT_TYPES: { quizComplete: "quiz_complete" },
      recordEvent: async () => {
        quizAnalyticsEvents += 1;
      },
    },
  });
  mock.module("@/lib/engagement/today-session/integrations", {
    namedExports: {
      markTodayComprehensionComplete: async (args: {
        userId: string;
        articleId: string;
        requestTimezone?: string | null;
        localDate?: string | null;
      }) => {
        todayCompletions += 1;
        lastTodayCompletion = args;
      },
    },
  });
  mock.module("@/lib/classroom", {
    namedExports: {
      markAssignmentQuizComplete: async () => {
        assignmentCompletions += 1;
      },
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
  quizAttemptCreateError = null;
  existingQuizAttempt = null;
  quizAttemptCreateCount = 0;
  articleMasteryUpdates = 0;
  learnerEvidenceWrites = 0;
  quizAnalyticsEvents = 0;
  todayCompletions = 0;
  lastTodayCompletion = undefined;
  assignmentCompletions = 0;
});

function quizRouteContext(id = "a1"): QuizRouteContext {
  return { params: Promise.resolve({ id }) };
}

function quizAttemptRequest(
  answers: SubmittedAnswer[],
  options: { id?: string; extraBody?: Record<string, unknown> } = {},
): Request {
  const id = options.id ?? "a1";
  return new Request(`http://localhost/api/reader/${id}/quiz/attempt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(options.extraBody ?? {}), answers }),
  });
}

function quizHistoryRequest(id = "a1"): Request {
  return new Request(`http://localhost/api/reader/${id}/quiz/history`);
}

// ---------------------------------------------------------------------------
// POST /api/reader/[id]/quiz/attempt
// ---------------------------------------------------------------------------

describe("POST /api/reader/[id]/quiz/attempt", () => {
  test("→ 401 when unauthenticated", async () => {
    authState = "unauth";
    const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
    const res = await POST(
      quizAttemptRequest(ALL_CORRECT_ANSWERS),
      quizRouteContext(),
    );
    assert.equal(res.status, 401);
  });

  test("→ 404 when article not found", async () => {
    articleExists = false;
    maxAggResult = { _max: { scorePct: null } };
    const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
    const res = await POST(
      quizAttemptRequest([{ index: 0, selectedIndex: 1 }], { id: "missing" }),
      quizRouteContext("missing"),
    );
    assert.equal(res.status, 404);
  });

  test("→ 400 when submitted answer count != cached quiz length", async () => {
    maxAggResult = { _max: { scorePct: null } };
    const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
    const res = await POST(
      quizAttemptRequest([{ index: 0, selectedIndex: 1 }]),
      quizRouteContext(),
    );
    assert.equal(res.status, 400);
  });

  test("→ 400 when an unknown question index is submitted", async () => {
    maxAggResult = { _max: { scorePct: null } };
    const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
    const res = await POST(
      quizAttemptRequest([
        { index: 0, selectedIndex: 1 },
        { index: 1, selectedIndex: 0 },
        { index: 9, selectedIndex: 2 },
      ]),
      quizRouteContext(),
    );
    assert.equal(res.status, 400);
  });

  test("→ 400 when quiz unavailable (fallback)", async () => {
    quizFallback = true;
    quizQuestions = [];
    const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
    const res = await POST(
      quizAttemptRequest([{ index: 0, selectedIndex: 0 }]),
      quizRouteContext(),
    );
    assert.equal(res.status, 400);
  });

  test("→ persistence failures use a controlled response message", async () => {
    quizAttemptCreateError = new Error(
      "database failure included private quiz or provider detail",
    );
    const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
    const res = await POST(
      quizAttemptRequest(ALL_CORRECT_ANSWERS),
      quizRouteContext(),
    );

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "Invalid attempt data");
    assert.doesNotMatch(JSON.stringify(body), /private quiz|provider detail|database failure/);
  });

  test("→ server-grades all-correct answers (scorePct 100)", async () => {
    maxAggResult = { _max: { scorePct: 100 } };
    const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
    const res = await POST(
      quizAttemptRequest(ALL_CORRECT_ANSWERS),
      quizRouteContext(),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.attempt.correctCount, 3);
    assert.equal(body.attempt.totalQuestions, 3);
    assert.equal(body.attempt.scorePct, 100);
  });

  test("→ attributes delayed comprehension to the queued local date", async () => {
    maxAggResult = { _max: { scorePct: 100 } };
    const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
    const res = await POST(
      quizAttemptRequest(ALL_CORRECT_ANSWERS, {
        extraBody: {
          timezone: "America/Los_Angeles",
          localDate: "2000-01-01",
        },
      }),
      quizRouteContext(),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(lastTodayCompletion, {
      userId: "user-1",
      articleId: "a1",
      requestTimezone: "America/Los_Angeles",
      localDate: "2000-01-01",
    });
  });

  test("→ a forged high count cannot inflate the score (server-graded)", async () => {
    maxAggResult = { _max: { scorePct: 0 } };
    const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
    const res = await POST(
      quizAttemptRequest(
        [
          { index: 0, selectedIndex: 0 },
          { index: 1, selectedIndex: 1 },
          { index: 2, selectedIndex: 0 },
        ],
        { extraBody: { correctCount: 3, totalQuestions: 3 } },
      ),
      quizRouteContext(),
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
      quizAttemptRequest([
        { index: 0, selectedIndex: 1 },
        { index: 1, selectedIndex: 0 },
        { index: 2, selectedIndex: 0 },
      ]),
      quizRouteContext(),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.attempt.correctCount, 2);
    assert.equal(body.attempt.scorePct, 67);
  });

  test("→ replayed mutation ids do not repeat completion side effects", async () => {
    maxAggResult = { _max: { scorePct: 100 } };
    const { POST } = await import("@/app/api/reader/[id]/quiz/attempt/route");
    const request = () =>
      quizAttemptRequest(ALL_CORRECT_ANSWERS, {
        extraBody: { clientMutationId: "offline-replay-key" },
      });

    const first = await POST(request(), quizRouteContext());
    const replay = await POST(request(), quizRouteContext());

    assert.equal(first.status, 200);
    assert.equal(replay.status, 200);
    assert.equal(quizAttemptCreateCount, 1);
    assert.equal(articleMasteryUpdates, 1);
    assert.equal(learnerEvidenceWrites, 1);
    assert.equal(quizAnalyticsEvents, 1);
    assert.equal(todayCompletions, 1);
    assert.equal(assignmentCompletions, 1);
    assert.equal("created" in (await replay.json()), false);
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
      quizHistoryRequest(),
      quizRouteContext(),
    );
    assert.equal(res.status, 401);
  });

  test("→ 404 when article not found", async () => {
    articleExists = false;
    const { GET } = await import("@/app/api/reader/[id]/quiz/history/route");
    const res = await GET(
      quizHistoryRequest("missing"),
      quizRouteContext("missing"),
    );
    assert.equal(res.status, 404);
  });

  test("→ 200 with user's own attempts only", async () => {
    findManyRows = [
      { id: "atmp1", correctCount: 3, totalQuestions: 5, scorePct: 60, completedAt: new Date("2026-01-01") },
    ];
    const { GET } = await import("@/app/api/reader/[id]/quiz/history/route");
    const res = await GET(
      quizHistoryRequest(),
      quizRouteContext(),
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
