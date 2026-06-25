process.env.LOG_LEVEL = "error"; // silence request.start/complete logs

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { object, nonEmptyString } from "@/lib/validation";
import { getMetricsSnapshot, resetMetrics } from "@/lib/metrics";

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;

// ---- mutable auth state --------------------------------------------------
let authState: "ok" | "unauth" = "ok";
const session = { user: { id: "user-1", role: "Reader", name: "T", email: "t@e.com" } };

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
  mock.module("@/lib/prisma", {
    namedExports: { prisma: {} },
  });
});

beforeEach(() => {
  authState = "ok";
  resetMetrics();
});

// ---- unhandled error / production guard ----------------------------------

test("plain Error returns generic 500 when NODE_ENV=production", async () => {
  const prev = process.env.NODE_ENV;
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  try {
    const { createPublicHandler } = (await import("@/lib/api-handler")) as typeof import("@/lib/api-handler");
    const handler = createPublicHandler({}, async () => {
      throw new Error("internal secret that must never leak");
    }) as RouteHandler;
    const res = await handler(new Request("http://test/api/test"));
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, "Internal server error");
    assert.notEqual(body.error, "internal secret that must never leak");
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = prev;
  }
});

test("plain Error surfaces actual message when NODE_ENV!=production", async () => {
  const prev = process.env.NODE_ENV;
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";
  try {
    const { createPublicHandler } = (await import("@/lib/api-handler")) as typeof import("@/lib/api-handler");
    const handler = createPublicHandler({}, async () => {
      throw new Error("dev-visible error message");
    }) as RouteHandler;
    const res = await handler(new Request("http://test/api/test"));
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, "dev-visible error message");
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = prev;
  }
});

// ---- ApiError -----------------------------------------------------------

test("ApiError surfaces its status and message", async () => {
  const { createPublicHandler, ApiError } = (await import("@/lib/api-handler")) as typeof import("@/lib/api-handler");
  const handler = createPublicHandler({}, async () => {
    throw new ApiError(404, "resource not found");
  }) as RouteHandler;
  const res = await handler(new Request("http://test/api/test"));
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, "resource not found");
});

test("ApiError(409) surfaces correct status", async () => {
  const { createPublicHandler, ApiError } = (await import("@/lib/api-handler")) as typeof import("@/lib/api-handler");
  const handler = createPublicHandler({}, async () => {
    throw new ApiError(409, "conflict");
  }) as RouteHandler;
  const res = await handler(new Request("http://test/api/test"));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, "conflict");
});

// ---- validation failure --------------------------------------------------

test("body validation failure returns 400", async () => {
  const { createPublicHandler } = (await import("@/lib/api-handler")) as typeof import("@/lib/api-handler");
  const handler = createPublicHandler(
    { body: object({ word: nonEmptyString() }) },
    async () => NextResponse.json({ ok: true }),
  ) as RouteHandler;
  const res = await handler(
    new Request("http://test/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ word: "" }), // empty string fails nonEmptyString
    }),
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(typeof body.error === "string");
});

test("malformed JSON body returns 400", async () => {
  const { createPublicHandler } = (await import("@/lib/api-handler")) as typeof import("@/lib/api-handler");
  const handler = createPublicHandler(
    { body: object({ x: nonEmptyString() }) },
    async () => NextResponse.json({ ok: true }),
  ) as RouteHandler;
  const res = await handler(
    new Request("http://test/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json{{{",
    }),
  );
  assert.equal(res.status, 400);
});

// ---- x-request-id header ------------------------------------------------

test("successful response carries x-request-id header", async () => {
  const { createPublicHandler } = (await import("@/lib/api-handler")) as typeof import("@/lib/api-handler");
  const handler = createPublicHandler({}, async () => NextResponse.json({ ok: true })) as RouteHandler;
  const res = await handler(new Request("http://test/api/test"));
  assert.equal(res.status, 200);
  const rid = res.headers.get("x-request-id");
  assert.ok(rid && rid.length > 0, "x-request-id header must be present");
});

test("error response carries x-request-id header", async () => {
  const { createPublicHandler, ApiError } = (await import("@/lib/api-handler")) as typeof import("@/lib/api-handler");
  const handler = createPublicHandler({}, async () => {
    throw new ApiError(422, "unprocessable");
  }) as RouteHandler;
  const res = await handler(new Request("http://test/api/test"));
  assert.equal(res.status, 422);
  const rid = res.headers.get("x-request-id");
  assert.ok(rid && rid.length > 0, "error response must carry x-request-id");
});

test("valid inbound x-request-id UUID is echoed back", async () => {
  const { createPublicHandler } = (await import("@/lib/api-handler")) as typeof import("@/lib/api-handler");
  const handler = createPublicHandler({}, async () => NextResponse.json({ ok: true })) as RouteHandler;
  const inboundId = "550e8400-e29b-41d4-a716-446655440000";
  const res = await handler(
    new Request("http://test/api/test", {
      headers: { "x-request-id": inboundId },
    }),
  );
  assert.equal(res.headers.get("x-request-id"), inboundId);
});

test("invalid inbound x-request-id is replaced with a fresh UUID", async () => {
  const { createPublicHandler } = (await import("@/lib/api-handler")) as typeof import("@/lib/api-handler");
  const handler = createPublicHandler({}, async () => NextResponse.json({ ok: true })) as RouteHandler;
  const res = await handler(
    new Request("http://test/api/test", {
      headers: { "x-request-id": "not-a-uuid" },
    }),
  );
  const rid = res.headers.get("x-request-id");
  assert.ok(rid && rid !== "not-a-uuid", "invalid inbound id must not be echoed");
  assert.ok(rid && rid.length > 0);
});

// ---- auth-required handler -----------------------------------------------

test("createHandler returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { createHandler } = (await import("@/lib/api-handler")) as typeof import("@/lib/api-handler");
  const handler = createHandler({}, async () => NextResponse.json({ ok: true })) as RouteHandler;
  const res = await handler(new Request("http://test/api/test"));
  assert.equal(res.status, 401);
});

test("createPublicHandler records API metrics with sanitized route group", async () => {
  const { createPublicHandler } = (await import("@/lib/api-handler")) as typeof import("@/lib/api-handler");
  const handler = createPublicHandler({}, async () => NextResponse.json({ ok: true })) as RouteHandler;
  const res = await handler(new Request("http://test/api/reader/raw-article-id-123456/progress"));
  assert.equal(res.status, 200);

  const apiMetric = getMetricsSnapshot().counters.find(
    (point) =>
      point.name === "readwise_api_requests_total" &&
      point.labels.method === "get" &&
      point.labels.route === "/api/reader/[id]/progress" &&
      point.labels.status === "200",
  );
  assert.equal(apiMetric?.value, 1);
});
