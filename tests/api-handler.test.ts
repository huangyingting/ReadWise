process.env.LOG_LEVEL = "error"; // silence request.start/complete logs

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { object, nonEmptyString } from "@/lib/validation";
import { getMetricsSnapshot, resetMetrics } from "@/lib/metrics";
import { type RouteHandler } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

type ApiHandlerModule = typeof import("@/lib/api-handler");
type ApiErrorModule = typeof import("@/lib/errors/api-error");

// ---- mutable auth state --------------------------------------------------
let authState: AuthState = "ok";

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
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

async function loadApiHandler(): Promise<ApiHandlerModule> {
  return import("@/lib/api-handler") as Promise<ApiHandlerModule>;
}

async function loadApiErrorModule(): Promise<ApiErrorModule> {
  return import("@/lib/errors/api-error") as Promise<ApiErrorModule>;
}

async function createOkPublicHandler(): Promise<RouteHandler> {
  const { createPublicHandler } = await loadApiHandler();
  return createPublicHandler({}, async () => NextResponse.json({ ok: true })) as RouteHandler;
}

async function withNodeEnv<T>(
  value: string,
  callback: () => Promise<T>,
): Promise<T> {
  const prev = process.env.NODE_ENV;
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
  try {
    return await callback();
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = prev;
  }
}

test("plain Error returns generic 500 when NODE_ENV=production", async () => {
  await withNodeEnv("production", async () => {
    const { createPublicHandler } = await loadApiHandler();
    const handler = createPublicHandler({}, async () => {
      throw new Error("internal secret that must never leak");
    }) as RouteHandler;
    const res = await handler(new Request("http://test/api/test"));
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, "Internal server error");
    assert.notEqual(body.error, "internal secret that must never leak");
  });
});

test("plain Error surfaces actual message when NODE_ENV!=production", async () => {
  await withNodeEnv("development", async () => {
    const { createPublicHandler } = await loadApiHandler();
    const handler = createPublicHandler({}, async () => {
      throw new Error("dev-visible error message");
    }) as RouteHandler;
    const res = await handler(new Request("http://test/api/test"));
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, "dev-visible error message");
  });
});

// ---- ApiError -----------------------------------------------------------

test("ApiError surfaces its status and message", async () => {
  const { createPublicHandler, ApiError } = await loadApiHandler();
  const handler = createPublicHandler({}, async () => {
    throw new ApiError(404, "resource not found");
  }) as RouteHandler;
  const res = await handler(new Request("http://test/api/test"));
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, "resource not found");
});

test("ApiError(409) surfaces correct status", async () => {
  const { createPublicHandler, ApiError } = await loadApiHandler();
  const handler = createPublicHandler({}, async () => {
    throw new ApiError(409, "conflict");
  }) as RouteHandler;
  const res = await handler(new Request("http://test/api/test"));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, "conflict");
});

test("api-handler ApiError re-export keeps runtime identity", async () => {
  const { ApiError: ApiHandlerError } = await loadApiHandler();
  const { ApiError: FoundationError } = await loadApiErrorModule();
  assert.equal(ApiHandlerError, FoundationError);

  const fromFoundation = new FoundationError(418, "teapot");
  assert.ok(fromFoundation instanceof ApiHandlerError);
  assert.equal(fromFoundation.status, 418);
  assert.equal(fromFoundation.message, "teapot");
});

test("handler catches ApiError thrown from foundation module import", async () => {
  const { createPublicHandler } = await loadApiHandler();
  const { ApiError } = await loadApiErrorModule();
  const handler = createPublicHandler({}, async () => {
    throw new ApiError(410, "gone");
  }) as RouteHandler;
  const res = await handler(new Request("http://test/api/test"));
  assert.equal(res.status, 410);
  assert.equal((await res.json()).error, "gone");
});

// ---- validation failure --------------------------------------------------

test("body validation failure returns 400", async () => {
  const { createPublicHandler } = await loadApiHandler();
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
  const { createPublicHandler } = await loadApiHandler();
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
  const handler = await createOkPublicHandler();
  const res = await handler(new Request("http://test/api/test"));
  assert.equal(res.status, 200);
  const rid = res.headers.get("x-request-id");
  assert.ok(rid && rid.length > 0, "x-request-id header must be present");
});

test("error response carries x-request-id header", async () => {
  const { createPublicHandler, ApiError } = await loadApiHandler();
  const handler = createPublicHandler({}, async () => {
    throw new ApiError(422, "unprocessable");
  }) as RouteHandler;
  const res = await handler(new Request("http://test/api/test"));
  assert.equal(res.status, 422);
  const rid = res.headers.get("x-request-id");
  assert.ok(rid && rid.length > 0, "error response must carry x-request-id");
});

test("valid inbound x-request-id UUID is echoed back", async () => {
  const handler = await createOkPublicHandler();
  const inboundId = "550e8400-e29b-41d4-a716-446655440000";
  const res = await handler(
    new Request("http://test/api/test", {
      headers: { "x-request-id": inboundId },
    }),
  );
  assert.equal(res.headers.get("x-request-id"), inboundId);
});

test("invalid inbound x-request-id is replaced with a fresh UUID", async () => {
  const handler = await createOkPublicHandler();
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
  const { createHandler } = await loadApiHandler();
  const handler = createHandler({}, async () => NextResponse.json({ ok: true })) as RouteHandler;
  const res = await handler(new Request("http://test/api/test"));
  assert.equal(res.status, 401);
});

test("createPublicHandler records API metrics with sanitized route group", async () => {
  const handler = await createOkPublicHandler();
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
