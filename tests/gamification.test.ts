process.env.LOG_LEVEL = "error";
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;

// ---- mutable auth state --------------------------------------------------
let authState: "ok" | "unauth" = "ok";
const session = { user: { id: "user-1", role: "Reader", name: "T", email: "t@e.com" } };

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

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () =>
        authState === "unauth"
          ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
          : { session },
      requireAdminApi: async () => ({ session }),
    },
  });

  mock.module("@/lib/activity", {
    namedExports: {
      getStreakSummary: async () => streakResult,
    },
  });

  mock.module("@/lib/flashcards", {
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
  const { GET } = (await import("@/app/api/gamification/summary/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/gamification/summary"), undefined);
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
  const { GET } = (await import("@/app/api/gamification/summary/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/gamification/summary"), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.streakShields, 1);
});

test("GET gamification/summary returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { GET } = (await import("@/app/api/gamification/summary/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/gamification/summary"), undefined);
  assert.equal(res.status, 401);
});

// ---- GET /api/study/flashcards -------------------------------------------

test("GET study/flashcards returns empty cards when none are due", async () => {
  const { GET } = (await import("@/app/api/study/flashcards/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/study/flashcards"), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.cards, []);
  assert.equal(body.dueCount, 5);
});

test("GET study/flashcards returns due cards", async () => {
  flashcards = [{ id: "sw-1", word: "ephemeral", explanation: "short-lived", example: null }];
  const { GET } = (await import("@/app/api/study/flashcards/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/study/flashcards"), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.cards.length, 1);
  assert.equal(body.cards[0].word, "ephemeral");
});

test("GET study/flashcards returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { GET } = (await import("@/app/api/study/flashcards/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/study/flashcards"), undefined);
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
  const { POST } = (await import("@/app/api/study/flashcards/grade/route")) as { POST: RouteHandler };
  const res = await POST(gradeReq({ savedWordId: "sw-1", grade: "good" }), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.dueAt); // ISO string
  assert.equal(body.dueCount, 5);
});

test("POST flashcards/grade returns 400 for invalid grade", async () => {
  const { POST } = (await import("@/app/api/study/flashcards/grade/route")) as { POST: RouteHandler };
  const res = await POST(gradeReq({ savedWordId: "sw-1", grade: "perfect" }), undefined);
  assert.equal(res.status, 400);
});

test("POST flashcards/grade returns 400 when savedWordId is missing", async () => {
  const { POST } = (await import("@/app/api/study/flashcards/grade/route")) as { POST: RouteHandler };
  const res = await POST(gradeReq({ grade: "good" }), undefined);
  assert.equal(res.status, 400);
});

test("POST flashcards/grade returns 404 when card not found or not user's", async () => {
  gradeResult = null;
  const { POST } = (await import("@/app/api/study/flashcards/grade/route")) as { POST: RouteHandler };
  const res = await POST(gradeReq({ savedWordId: "not-mine", grade: "easy" }), undefined);
  assert.equal(res.status, 404);
});

test("POST flashcards/grade returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { POST } = (await import("@/app/api/study/flashcards/grade/route")) as { POST: RouteHandler };
  const res = await POST(gradeReq({ savedWordId: "sw-1", grade: "hard" }), undefined);
  assert.equal(res.status, 401);
});
