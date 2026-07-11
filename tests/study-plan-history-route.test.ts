/**
 * Route tests for GET /api/study/plan/history.
 *
 * Validates:
 * - Auth required (401 when unauthenticated)
 * - Returns history array on success
 * - Respects limit parameter
 * - Default limit behavior
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { getReq, readJson, type RouteHandler } from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";

let authState: AuthState = "ok";
let historyResult: unknown[] = [];
let lastHistoryArgs: { userId: string; limit: number } | null = null;

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => authState),
  });

  mock.module("@/lib/learning/study-plan", {
    namedExports: {
      getStudyPlanHistory: async (userId: string, opts: { limit: number }) => {
        lastHistoryArgs = { userId, limit: opts.limit };
        return historyResult;
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  lastHistoryArgs = null;
  historyResult = [
    { weekOf: "2026-07-07", goalsCompleted: 3, totalGoals: 5 },
    { weekOf: "2026-06-30", goalsCompleted: 4, totalGoals: 5 },
  ];
});

let GET: RouteHandler;
before(async () => {
  const mod = await import("@/app/api/study/plan/history/route");
  GET = mod.GET as unknown as RouteHandler;
});

test("GET /api/study/plan/history returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await GET(getReq("http://test/api/study/plan/history"));
  assert.equal(res.status, 401);
});

test("GET /api/study/plan/history returns history array on success", async () => {
  const res = await GET(getReq("http://test/api/study/plan/history"));
  assert.equal(res.status, 200);
  const body = await readJson<{ history: unknown[] }>(res);
  assert.ok(Array.isArray(body.history));
  assert.equal(body.history.length, 2);
});

test("GET /api/study/plan/history passes user id to service", async () => {
  await GET(getReq("http://test/api/study/plan/history"));
  assert.equal(lastHistoryArgs?.userId, "user-1");
});

test("GET /api/study/plan/history uses default limit of 8", async () => {
  await GET(getReq("http://test/api/study/plan/history"));
  assert.equal(lastHistoryArgs?.limit, 8);
});

test("GET /api/study/plan/history respects custom limit", async () => {
  await GET(getReq("http://test/api/study/plan/history?limit=20"));
  assert.equal(lastHistoryArgs?.limit, 20);
});

test("GET /api/study/plan/history clamps limit to max 52", async () => {
  await GET(getReq("http://test/api/study/plan/history?limit=100"));
  assert.equal(lastHistoryArgs?.limit, 52);
});

test("GET /api/study/plan/history clamps limit to min 1", async () => {
  await GET(getReq("http://test/api/study/plan/history?limit=0"));
  assert.equal(lastHistoryArgs?.limit, 1);
});
