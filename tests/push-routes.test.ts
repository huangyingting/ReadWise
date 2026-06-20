/**
 * Route-level tests for the hardened push subscribe/unsubscribe endpoints.
 *
 * Covers: 400 bad endpoint URL, 409 subscription cap, and happy-path 201.
 *
 * Mocks: @/lib/api-auth, @/lib/push, @/lib/prisma, @/lib/rate-limit.
 * No real DB or push service touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

const session = { user: { id: "user-1", role: "Reader", name: "T", email: "t@e.com" } };

let pushEnabled = true;
let existingSubForEndpoint: { userId: string } | null = null;
let subscriptionCount = 0;

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () => ({ session }),
      requireAdminApi: async () => ({ session }),
    },
  });

  mock.module("@/lib/push", {
    namedExports: {
      isPushConfigured: () => pushEnabled,
      vapidPublicKey: () => (pushEnabled ? "BFakePubKey" : null),
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        pushSubscription: {
          findUnique: async () => existingSubForEndpoint,
          count: async () => subscriptionCount,
          upsert: async (args: {
            create: { userId: string; endpoint: string; p256dh: string; auth: string };
          }) => args.create,
          deleteMany: async () => ({ count: 0 }),
        },
      },
    },
  });

  // Allow rate limit through without hitting the limit in tests.
  mock.module("@/lib/rate-limit", {
    namedExports: {
      checkRateLimit: () => {},
      checkRateLimitByKey: () => {},
      clientIpKey: () => "ip:test",
    },
  });
});

beforeEach(() => {
  pushEnabled = true;
  existingSubForEndpoint = null;
  subscriptionCount = 0;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function subBody(
  endpoint = "https://push.example.com/sub",
  p256dh = "BAAAAA",
  auth = "auth123",
) {
  return new Request("http://test/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint, p256dh, auth }),
  });
}

// ---------------------------------------------------------------------------
// Subscribe — 400 bad URL
// ---------------------------------------------------------------------------

test("POST /api/push/subscribe returns 400 for a non-URL endpoint", async () => {
  const { POST } = (await import(
    "@/app/api/push/subscribe/route"
  )) as { POST: RouteHandler };

  const res = await POST(
    subBody("not-a-url"),
    undefined,
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(typeof body.error === "string");
});

test("POST /api/push/subscribe returns 400 for an HTTP (non-HTTPS) endpoint", async () => {
  const { POST } = (await import(
    "@/app/api/push/subscribe/route"
  )) as { POST: RouteHandler };

  const res = await POST(
    subBody("http://push.example.com/sub"),
    undefined,
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(typeof body.error === "string");
});

// ---------------------------------------------------------------------------
// Subscribe — 409 subscription cap
// ---------------------------------------------------------------------------

test("POST /api/push/subscribe returns 409 when per-user cap is reached", async () => {
  const { POST } = (await import(
    "@/app/api/push/subscribe/route"
  )) as { POST: RouteHandler };

  // No existing subscription for this endpoint — triggers count check.
  existingSubForEndpoint = null;
  subscriptionCount = 10; // at the cap

  const res = await POST(subBody(), undefined);
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.ok(typeof body.error === "string");
});

// ---------------------------------------------------------------------------
// Subscribe — 201 happy path
// ---------------------------------------------------------------------------

test("POST /api/push/subscribe returns 201 for a valid new subscription", async () => {
  const { POST } = (await import(
    "@/app/api/push/subscribe/route"
  )) as { POST: RouteHandler };

  existingSubForEndpoint = null;
  subscriptionCount = 0;

  const res = await POST(subBody(), undefined);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
});

test("POST /api/push/subscribe returns 201 when re-subscribing an existing endpoint (upsert)", async () => {
  const { POST } = (await import(
    "@/app/api/push/subscribe/route"
  )) as { POST: RouteHandler };

  // Existing sub for this endpoint — skips count check, goes straight to upsert.
  existingSubForEndpoint = { userId: "user-1" };
  subscriptionCount = 10; // would fail if count check ran

  const res = await POST(subBody(), undefined);
  assert.equal(res.status, 201);
});
