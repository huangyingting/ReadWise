/**
 * Route tests for GET /api/push/vapid-public-key.
 *
 * Validates:
 * - Returns the VAPID public key when push is configured
 * - Returns 503 when push is not configured
 * - No auth required (public endpoint)
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { getReq, readJson, type RouteHandler } from "./support/route";

let vapidKey: string | null = "BNhUq3-dummy-vapid-public-key-for-testing";

before(() => {
  mock.module("@/lib/push/provider", {
    namedExports: {
      vapidPublicKey: () => vapidKey,
    },
  });
});

beforeEach(() => {
  vapidKey = "BNhUq3-dummy-vapid-public-key-for-testing";
});

let GET: RouteHandler;
before(async () => {
  const mod = await import("@/app/api/push/vapid-public-key/route");
  GET = mod.GET as unknown as RouteHandler;
});

test("GET /api/push/vapid-public-key returns key when configured", async () => {
  const res = await GET(getReq("http://test/api/push/vapid-public-key"));
  assert.equal(res.status, 200);
  const body = await readJson<{ configured: boolean; publicKey: string }>(res);
  assert.equal(body.configured, true);
  assert.equal(body.publicKey, "BNhUq3-dummy-vapid-public-key-for-testing");
});

test("GET /api/push/vapid-public-key returns 503 when not configured", async () => {
  vapidKey = null;
  const res = await GET(getReq("http://test/api/push/vapid-public-key"));
  assert.equal(res.status, 503);
  const body = await readJson<{ configured: boolean }>(res);
  assert.equal(body.configured, false);
});

test("GET /api/push/vapid-public-key response is JSON", async () => {
  const res = await GET(getReq("http://test/api/push/vapid-public-key"));
  const ct = res.headers.get("content-type") ?? "";
  assert.ok(ct.includes("application/json"));
});
