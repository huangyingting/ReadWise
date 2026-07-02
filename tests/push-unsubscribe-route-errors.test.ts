/**
 * Focused route-error coverage for POST /api/push/unsubscribe.
 *
 * Keeps the main push route tests on the real command implementation while
 * exercising the route's defensive DomainResult error mapping in isolation.
 */
process.env.LOG_LEVEL = "error";

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { jsonPost, type RouteHandler } from "./support/route";
import { sessionAuthExports } from "./support/auth-mock";

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => "ok"),
  });

  mock.module("@/lib/push/provider", {
    namedExports: {
      isPushConfigured: () => true,
    },
  });

  mock.module("@/lib/security/rate-limit/index", {
    namedExports: {
      checkRateLimit: () => {},
    },
  });

  mock.module("@/lib/push/commands", {
    namedExports: {
      unsubscribePush: async () => ({ ok: false, status: 409, error: "cannot unsubscribe" }),
    },
  });
});

test("POST /api/push/unsubscribe maps command errors to ApiError responses", async () => {
  const { POST } = (await import("@/app/api/push/unsubscribe/route")) as { POST: RouteHandler };

  const res = await POST(
    jsonPost("http://test/api/push/unsubscribe", { endpoint: "https://push.example.com/sub" }),
    undefined,
  );

  assert.equal(res.status, 409);
  const body = await res.json() as { error?: unknown };
  assert.equal(body.error, "cannot unsubscribe");
});
