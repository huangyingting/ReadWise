/**
 * Route tests for the curated series enrollment API (#813):
 *   POST   /api/series/[id]/enroll
 *   DELETE /api/series/[id]/enroll
 *   GET    /api/series
 *
 * Verifies the auth gate (401 unauthenticated) and the 404 for a missing or
 * non-public series. The series module is mocked so only the route wiring is
 * under test.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { sessionAuthExports } from "./support/auth-mock";
import { withParams, getReq, deleteReq, readJson } from "./support/route";

type AuthState = "ok" | "unauth";
let authState: AuthState = "ok";
let publicSeriesExists = true;

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => authState),
  });
  mock.module("@/lib/engagement/series", {
    namedExports: {
      enrollInSeries: async () =>
        publicSeriesExists
          ? { ok: true, status: "active" }
          : { ok: false, reason: "not_found" },
      unenrollFromSeries: async () =>
        publicSeriesExists ? { ok: true, status: "active" } : { ok: false, reason: "not_found" },
      listPublicSeriesForUser: async () => [],
    },
  });
});

beforeEach(() => {
  authState = "ok";
  publicSeriesExists = true;
});

async function POST(id: string) {
  const { POST: handler } = await import("@/app/api/series/[id]/enroll/route");
  return handler(
    new Request(`http://localhost/api/series/${id}/enroll`, { method: "POST" }),
    withParams({ id }),
  );
}

async function DELETE(id: string) {
  const { DELETE: handler } = await import("@/app/api/series/[id]/enroll/route");
  return handler(deleteReq(`http://localhost/api/series/${id}/enroll`), withParams({ id }));
}

async function GET() {
  const { GET: handler } = await import("@/app/api/series/route");
  return handler(getReq("http://localhost/api/series"), withParams({}));
}

// ---------------------------------------------------------------------------

test("POST enroll: 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await POST("s1");
  assert.equal(res.status, 401);
});

test("POST enroll: 200 for a public series", async () => {
  publicSeriesExists = true;
  const res = await POST("s1");
  assert.equal(res.status, 200);
  const body = await readJson<{ ok: boolean }>(res);
  assert.equal(body.ok, true);
});

test("POST enroll: 404 for a missing or non-public series", async () => {
  publicSeriesExists = false;
  const res = await POST("missing");
  assert.equal(res.status, 404);
});

test("DELETE unenroll: 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await DELETE("s1");
  assert.equal(res.status, 401);
});

test("DELETE unenroll: 404 for a missing or non-public series", async () => {
  publicSeriesExists = false;
  const res = await DELETE("missing");
  assert.equal(res.status, 404);
});

test("GET /api/series: 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await GET();
  assert.equal(res.status, 401);
});

test("GET /api/series: 200 returns a series list for an authenticated user", async () => {
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await readJson<{ series: unknown[] }>(res);
  assert.ok(Array.isArray(body.series));
});
