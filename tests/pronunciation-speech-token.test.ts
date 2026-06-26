/**
 * Tests for the GET /api/speech/token endpoint (M16 Pronunciation Practice).
 *
 * Mocks: @/lib/api-auth, @/lib/speech, globalThis.fetch.
 * No real DB, network, or Azure Speech SDK touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock, describe } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let authState: AuthState = "ok";
let speechConfigured = true;
let mockFetchShouldThrow = false;
let mockFetchStatus = 200;
const MOCK_TOKEN = "azure-token-xyz";

// ---------------------------------------------------------------------------
// Module mocks — registered once before any module-under-test is imported
// ---------------------------------------------------------------------------

before(() => {
  globalThis.fetch = (async (
    _input: RequestInfo | URL,
    _init?: RequestInit,
  ): Promise<Response> => {
    if (mockFetchShouldThrow) throw new Error("Network failure");
    return new Response(mockFetchStatus === 200 ? MOCK_TOKEN : "error", {
      status: mockFetchStatus,
    });
  }) as typeof fetch;

  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  mock.module("@/lib/speech", {
    namedExports: {
      isSpeechConfigured: () => speechConfigured,
    },
  });
});

beforeEach(() => {
  authState = "ok";
  speechConfigured = true;
  mockFetchShouldThrow = false;
  mockFetchStatus = 200;
  process.env.AZURE_SPEECH_KEY = "test-key";
  process.env.AZURE_SPEECH_REGION = "eastus";
});

// ---------------------------------------------------------------------------
// GET /api/speech/token — token endpoint
// ---------------------------------------------------------------------------

describe("GET /api/speech/token", () => {
  test("returns configured:false when Speech unconfigured", async () => {
    speechConfigured = false;
    const { GET } = (await import("@/app/api/speech/token/route")) as {
      GET: RouteHandler;
    };
    const res = await GET(new Request("http://test/api/speech/token"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.configured, false);
    assert.ok(!("token" in body), "key must not be exposed");
  });

  test("returns {configured:true, token, region} on success", async () => {
    const { GET } = (await import("@/app/api/speech/token/route")) as {
      GET: RouteHandler;
    };
    const res = await GET(new Request("http://test/api/speech/token"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.configured, true);
    assert.equal(body.token, MOCK_TOKEN);
    assert.equal(body.region, "eastus");
    assert.ok(!("key" in body), "AZURE_SPEECH_KEY must never be sent");
  });

  test("returns 502 with {configured:true, error} when issueToken call fails (non-2xx)", async () => {
    mockFetchStatus = 401;
    const { GET } = (await import("@/app/api/speech/token/route")) as {
      GET: RouteHandler;
    };
    const res = await GET(new Request("http://test/api/speech/token"));
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.configured, true);
    assert.ok("error" in body);
  });

  test("returns 502 when fetch throws (network error)", async () => {
    mockFetchShouldThrow = true;
    const { GET } = (await import("@/app/api/speech/token/route")) as {
      GET: RouteHandler;
    };
    const res = await GET(new Request("http://test/api/speech/token"));
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.configured, true);
    assert.ok("error" in body);
  });

  test("returns 401 when unauthenticated", async () => {
    authState = "unauth";
    const { GET } = (await import("@/app/api/speech/token/route")) as {
      GET: RouteHandler;
    };
    const res = await GET(new Request("http://test/api/speech/token"));
    assert.equal(res.status, 401);
  });
});
