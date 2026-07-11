/**
 * Route tests for GET /api/health.
 *
 * Validates:
 * - Returns 200 with JSON { status: "ok", timestamp: <ISO string> }
 * - No auth required (public handler)
 * - Response shape is stable and correct
 */
process.env.LOG_LEVEL = "error";

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { getReq, readJson, type RouteHandler } from "./support/route";

let GET: RouteHandler;

before(async () => {
  const mod = await import("@/app/api/health/route");
  GET = mod.GET as unknown as RouteHandler;
});

test("GET /api/health returns 200 with status ok", async () => {
  const res = await GET(getReq("http://test/api/health"));
  assert.equal(res.status, 200);
  const body = await readJson<{ status: string; timestamp: string }>(res);
  assert.equal(body.status, "ok");
});

test("GET /api/health includes a valid ISO timestamp", async () => {
  const before = Date.now();
  const res = await GET(getReq("http://test/api/health"));
  const after = Date.now();
  const body = await readJson<{ status: string; timestamp: string }>(res);

  const ts = new Date(body.timestamp).getTime();
  assert.ok(ts >= before && ts <= after, "timestamp should be between request start and end");
});

test("GET /api/health response has correct content-type", async () => {
  const res = await GET(getReq("http://test/api/health"));
  const ct = res.headers.get("content-type") ?? "";
  assert.ok(ct.includes("application/json"), `expected JSON content-type, got: ${ct}`);
});
