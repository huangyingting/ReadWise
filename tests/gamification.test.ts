process.env.LOG_LEVEL = "error";
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

// ---- mutable auth state --------------------------------------------------
let authState: AuthState = "ok";

// ---- mutable lib return values -------------------------------------------
let streakResult = {
  currentStreak: 3,
  longestStreak: 7,
  dailyGoal: 2,
  todayProgress: 1,
  streakShields: 1,
  last7Days: [
    { date: "2026-06-13", active: false },
    { date: "2026-06-14", active: true },
    { date: "2026-06-15", active: true },
    { date: "2026-06-16", active: true },
    { date: "2026-06-17", active: false },
    { date: "2026-06-18", active: true },
    { date: "2026-06-19", active: true },
  ],
};
let reviewSummary = { dueCount: 5, totalSaved: 20 };
let flashcards: { id: string; word: string; explanation: string | null; example: string | null }[] = [];
let gradeResult: { dueAt: Date | null; intervalDays: number } | null = null;

const routeRequest = (path: string) => new Request(`http://test${path}`);

async function summaryGet() {
  const { GET } = (await import("@/app/api/gamification/summary/route")) as { GET: RouteHandler };
  return GET(routeRequest("/api/gamification/summary"), undefined);
}

async function flashcardsGet() {
  const { GET } = (await import("@/app/api/study/flashcards/route")) as { GET: RouteHandler };
  return GET(routeRequest("/api/study/flashcards"), undefined);
}

async function gradePost(body: unknown) {
  const { POST } = (await import("@/app/api/study/flashcards/grade/route")) as {
    POST: RouteHandler;
  };
  return POST(gradeReq(body), undefined);
}

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  mock.module("@/lib/engagement/streak", {
    namedExports: {
      getStreakSummary: async () => streakResult,
    },
  });

  mock.module("@/lib/learning/flashcards", {
    namedExports: {
      getDueFlashcards: async () => flashcards,
      gradeFlashcard: async (_uid: string, _id: string, _grade: string) => gradeResult,
      getReviewSummary: async () => reviewSummary,
    },
  });
});

beforeEach(() => {
  authState = "ok";
  flashcards = [];
  gradeResult = { dueAt: new Date("2026-06-26T00:00:00Z"), intervalDays: 7 };
  reviewSummary = { dueCount: 5, totalSaved: 20 };
});

// ---- GET /api/gamification/summary ---------------------------------------

test("GET gamification/summary returns streak + dueCount", async () => {
  const res = await summaryGet();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.currentStreak, 3);
  assert.equal(body.longestStreak, 7);
  assert.equal(body.dailyGoal, 2);
  assert.equal(body.todayProgress, 1);
  assert.equal(body.dueCount, 5);
  assert.equal(body.last7Days.length, 7);
});

test("GET gamification/summary includes streakShields in response", async () => {
  const res = await summaryGet();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.streakShields, 1);
});

test("GET gamification/summary returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await summaryGet();
  assert.equal(res.status, 401);
});

// ---- GET /api/study/flashcards -------------------------------------------

test("GET study/flashcards returns empty cards when none are due", async () => {
  const res = await flashcardsGet();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.cards, []);
  assert.equal(body.dueCount, 5);
});

test("GET study/flashcards returns due cards", async () => {
  flashcards = [{ id: "sw-1", word: "ephemeral", explanation: "short-lived", example: null }];
  const res = await flashcardsGet();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.cards.length, 1);
  assert.equal(body.cards[0].word, "ephemeral");
});

test("GET study/flashcards returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await flashcardsGet();
  assert.equal(res.status, 401);
});

// ---- POST /api/study/flashcards/grade ------------------------------------

function gradeReq(body: unknown): Request {
  return new Request("http://test/api/study/flashcards/grade", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("POST flashcards/grade happy path returns dueAt and dueCount", async () => {
  const res = await gradePost({ savedWordId: "sw-1", grade: "good" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.dueAt); // ISO string
  assert.equal(body.dueCount, 5);
});

test("POST flashcards/grade returns 400 for invalid grade", async () => {
  const res = await gradePost({ savedWordId: "sw-1", grade: "perfect" });
  assert.equal(res.status, 400);
});

test("POST flashcards/grade returns 400 when savedWordId is missing", async () => {
  const res = await gradePost({ grade: "good" });
  assert.equal(res.status, 400);
});

test("POST flashcards/grade returns 404 when card not found or not user's", async () => {
  gradeResult = null;
  const res = await gradePost({ savedWordId: "not-mine", grade: "easy" });
  assert.equal(res.status, 404);
});

test("POST flashcards/grade returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await gradePost({ savedWordId: "sw-1", grade: "hard" });
  assert.equal(res.status, 401);
});
