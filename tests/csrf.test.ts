/**
 * CSRF / same-origin enforcement (RW-028). Tests the `checkSameOrigin` helper
 * directly and its enforcement inside the shared api-handler mutation path.
 */
process.env.LOG_LEVEL = "error"; // silence request + security logs

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { checkSameOrigin, isStateChangingMethod } from "@/lib/security/csrf";

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;

let authState: "ok" | "unauth" = "ok";
const session = { user: { id: "user-1", role: "Admin", name: "T", email: "t@e.com" } };

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () =>
        authState === "unauth"
          ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
          : { session },
      requireCapabilityApi: async () =>
        authState === "unauth"
          ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
          : { session },
    },
  });
  mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
});

beforeEach(() => {
  authState = "ok";
  delete process.env.CSRF_ENFORCE;
  delete process.env.CSRF_ALLOWED_ORIGINS;
  delete process.env.CSRF_TRUSTED_ORIGINS;
  delete process.env.NEXTAUTH_URL;
});

// ---- helper: isStateChangingMethod ---------------------------------------

test("isStateChangingMethod flags mutating methods only", () => {
  for (const m of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
    assert.equal(isStateChangingMethod(m), true, m);
  }
  for (const m of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(isStateChangingMethod(m), false, m);
  }
});

// ---- helper: checkSameOrigin ---------------------------------------------

function postWith(headers: Record<string, string>): Request {
  return new Request("http://app.example/api/x", { method: "POST", headers });
}

test("safe GET requests are always allowed", () => {
  const req = new Request("http://app.example/api/x", {
    method: "GET",
    headers: { origin: "http://evil.example" },
  });
  assert.deepEqual(checkSameOrigin(req), { ok: true });
});

test("missing Origin on a mutation is treated as same-origin (allowed)", () => {
  assert.deepEqual(checkSameOrigin(postWith({})), { ok: true });
});

test("same-origin Origin is allowed", () => {
  assert.deepEqual(checkSameOrigin(postWith({ origin: "http://app.example" })), { ok: true });
});

test("cross-site Origin is rejected", () => {
  const decision = checkSameOrigin(postWith({ origin: "http://evil.example" }));
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.origin, "http://evil.example");
});

test("a foreign Origin matching the forwarded host is allowed (proxy-safe)", () => {
  const decision = checkSameOrigin(
    postWith({
      origin: "https://public.example",
      "x-forwarded-host": "public.example",
      "x-forwarded-proto": "https",
    }),
  );
  assert.deepEqual(decision, { ok: true });
});

test("a configured allowed origin passes", () => {
  process.env.CSRF_ALLOWED_ORIGINS = "https://trusted.partner";
  assert.deepEqual(
    checkSameOrigin(postWith({ origin: "https://trusted.partner" })),
    { ok: true },
  );
});

test("the literal null Origin is rejected on a mutation", () => {
  const decision = checkSameOrigin(postWith({ origin: "null" }));
  assert.equal(decision.ok, false);
});

test("Sec-Fetch-Site: cross-site without Origin is rejected", () => {
  const decision = checkSameOrigin(postWith({ "sec-fetch-site": "cross-site" }));
  assert.equal(decision.ok, false);
});

test("enforcement can be disabled via CSRF_ENFORCE=false", () => {
  process.env.CSRF_ENFORCE = "false";
  assert.deepEqual(checkSameOrigin(postWith({ origin: "http://evil.example" })), { ok: true });
});

// ---- integration: api-handler mutation path ------------------------------

test("api-handler rejects a cross-site Origin on a POST with 403", async () => {
  const { createPublicHandler } = await import("@/lib/api-handler");
  const handler = createPublicHandler({}, async () =>
    NextResponse.json({ ok: true }),
  ) as RouteHandler;
  const res = await handler(
    new Request("http://app.example/api/test", {
      method: "POST",
      headers: { origin: "http://evil.example" },
    }),
  );
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /cross-site/i);
});

test("api-handler allows a same-origin POST", async () => {
  const { createPublicHandler } = await import("@/lib/api-handler");
  const handler = createPublicHandler({}, async () =>
    NextResponse.json({ ok: true }),
  ) as RouteHandler;
  const res = await handler(
    new Request("http://app.example/api/test", {
      method: "POST",
      headers: { origin: "http://app.example" },
    }),
  );
  assert.equal(res.status, 200);
});

test("api-handler allows a POST with no Origin header (non-browser/test)", async () => {
  const { createPublicHandler } = await import("@/lib/api-handler");
  const handler = createPublicHandler({}, async () =>
    NextResponse.json({ ok: true }),
  ) as RouteHandler;
  const res = await handler(
    new Request("http://app.example/api/test", { method: "POST" }),
  );
  assert.equal(res.status, 200);
});

test("api-handler admin DELETE rejects unauthenticated callers with 401", async () => {
  authState = "unauth";
  const { createAdminHandler } = await import("@/lib/api-handler");
  const handler = createAdminHandler({}, async () =>
    NextResponse.json({ ok: true }),
  ) as RouteHandler;
  const res = await handler(
    new Request("http://app.example/api/admin/test", { method: "DELETE" }),
  );
  assert.equal(res.status, 401);
});
