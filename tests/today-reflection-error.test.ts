/**
 * Route test — POST /api/today/reflection error-result branch (#962).
 *
 * Exercises reflection/route.ts lines 40-41:
 *   if (!result.ok) {
 *     throw new ApiError(result.status, result.error);
 *   }
 *
 * Verifies that when recordTodayReflection returns { ok: false, status, error }
 * the handler maps it to the correct HTTP status, a body of { error, requestId },
 * and an x-request-id header whose value matches the body requestId — consistent
 * with the createHandler error-response contract (api-handler.ts jsonError).
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, jsonPost } from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";

const FLAG = "FEATURE_TODAY_SESSION_ENABLED";

let authState: AuthState = "ok";
let reflectionResult:
  | { ok: true; highlightId: string }
  | { ok: false; status: number; error: string } = { ok: true, highlightId: "hl-1" };

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => authState),
  });
  mock.module("@/lib/learning/review-assets", {
    namedExports: {
      recordTodayReflection: async () => reflectionResult,
    },
  });
});

beforeEach(() => {
  authState = "ok";
  reflectionResult = { ok: true, highlightId: "hl-1" };
  process.env[FLAG] = "true";
});

afterEach(() => {
  delete process.env[FLAG];
});

async function POST(body: unknown = {}) {
  const { POST: handler } = (await import(
    "@/app/api/today/reflection/route"
  )) as { POST: RouteHandler };
  return handler(jsonPost("http://localhost/api/today/reflection", body));
}

test("maps recordTodayReflection { ok: false, status: 404, error } to HTTP 404 with error body and x-request-id", async () => {
  reflectionResult = { ok: false, status: 404, error: "Highlight not found" };

  const res = await POST({ highlightId: "hl-99", sentence: "Great read." });

  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string; requestId: string };
  assert.equal(body.error, "Highlight not found");
  assert.ok(
    typeof body.requestId === "string" && body.requestId.length > 0,
    "body must carry a non-empty requestId",
  );
  assert.equal(
    res.headers.get("x-request-id"),
    body.requestId,
    "x-request-id header must match body requestId",
  );
});

test("maps recordTodayReflection { ok: false, status: 400, error } to HTTP 400 with error body", async () => {
  reflectionResult = {
    ok: false,
    status: 400,
    error: "reflection sentence is required",
  };

  // Pass a schema-valid sentence; the mock returns the 400 result regardless,
  // exercising the route's error-mapping branch (lines 40-41) for 4xx service errors.
  const res = await POST({ highlightId: "hl-1", sentence: "Valid sentence." });

  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; requestId: string };
  assert.equal(body.error, "reflection sentence is required");
  assert.ok(
    typeof body.requestId === "string" && body.requestId.length > 0,
    "body must carry a non-empty requestId",
  );
  assert.equal(
    res.headers.get("x-request-id"),
    body.requestId,
    "x-request-id header must match body requestId",
  );
});
