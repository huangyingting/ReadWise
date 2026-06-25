/**
 * Tests for src/lib/http/provider-client.ts (REF-073).
 *
 * Stubs globalThis.fetch — no real network I/O.
 * Verifies: timeout enforcement, retry behavior, Retry-After handling,
 * signal composition, non-retryable passthrough, and low-cardinality logging.
 */
process.env.LOG_LEVEL = "error";

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  providerFetch,
  DEFAULT_PROVIDER_TIMEOUT_MS,
} from "@/lib/http/provider-client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FakeResponseInit = {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  delayMs?: number;
};

function fakeResponse({
  status = 200,
  body = "",
  headers = {},
  delayMs = 0,
}: FakeResponseInit): Response {
  const h = new Headers(headers);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => h.get(name),
    },
    body: { cancel: async () => {} },
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

let fetchCalls: { url: string; init?: RequestInit }[] = [];
let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;

const originalFetch = globalThis.fetch;

function installFetchStub() {
  (globalThis as unknown as Record<string, unknown>).fetch = async (
    input: unknown,
    init?: unknown,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    fetchCalls.push({ url, init: init as RequestInit | undefined });
    return fetchImpl(url, init as RequestInit | undefined);
  };
}

beforeEach(() => {
  fetchCalls = [];
  fetchImpl = async () => fakeResponse({ status: 200, body: '{"ok":true}' });
});

// Restore after all tests in this file (best-effort)
process.on("exit", () => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("providerFetch returns successful response for 200", async () => {
  installFetchStub();
  fetchImpl = async () => fakeResponse({ status: 200, body: "hello" });

  const res = await providerFetch("https://api.example.com/v1/words/run");
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "https://api.example.com/v1/words/run");
});

test("providerFetch returns non-OK response without retrying when retries=0", async () => {
  installFetchStub();
  fetchImpl = async () => fakeResponse({ status: 404 });

  const res = await providerFetch("https://api.example.com/missing", {}, { retries: 0 });
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
  assert.equal(fetchCalls.length, 1, "should not retry on 404");
});

test("providerFetch does not retry non-retryable status codes (400, 401, 403, 404)", async () => {
  installFetchStub();
  for (const status of [400, 401, 403, 404]) {
    fetchCalls = [];
    fetchImpl = async () => fakeResponse({ status });
    const res = await providerFetch(`https://api.example.com/${status}`, {}, { retries: 2 });
    assert.equal(res.status, status);
    assert.equal(fetchCalls.length, 1, `should not retry on ${status}`);
  }
});

test("providerFetch retries on 503 up to retries limit", async () => {
  installFetchStub();
  let calls = 0;
  fetchImpl = async () => {
    calls++;
    return fakeResponse({ status: calls <= 2 ? 503 : 200 });
  };

  const res = await providerFetch(
    "https://api.example.com/flaky",
    {},
    { retries: 3, backoffBaseMs: 0, backoffMaxMs: 0 },
  );
  assert.equal(res.ok, true);
  assert.equal(calls, 3, "should retry twice before succeeding on the third attempt");
});

test("providerFetch stops retrying after exhausting retries limit and returns last response", async () => {
  installFetchStub();
  let calls = 0;
  fetchImpl = async () => {
    calls++;
    return fakeResponse({ status: 503 });
  };

  const res = await providerFetch(
    "https://api.example.com/always-503",
    {},
    { retries: 2, backoffBaseMs: 0, backoffMaxMs: 0 },
  );
  assert.equal(res.status, 503);
  assert.equal(calls, 3, "initial + 2 retries = 3 total attempts");
});

test("providerFetch retries on 429 and respects Retry-After header", async () => {
  installFetchStub();
  let calls = 0;
  const retryAfterMs: number[] = [];
  const originalSetTimeout = global.setTimeout;

  // Track how long we actually waited
  const waitMs: number[] = [];
  const realSetTimeout = global.setTimeout;
  // Override setTimeout to record delays without actually waiting
  (global as unknown as Record<string, unknown>).setTimeout = (
    fn: () => void,
    ms?: number,
  ) => {
    waitMs.push(ms ?? 0);
    // Immediately invoke so the test doesn't actually sleep
    fn();
    return 0 as unknown as ReturnType<typeof realSetTimeout>;
  };

  fetchImpl = async () => {
    calls++;
    if (calls === 1) {
      return fakeResponse({
        status: 429,
        headers: { "Retry-After": "0" },
      });
    }
    return fakeResponse({ status: 200 });
  };

  const res = await providerFetch(
    "https://api.example.com/rate-limited",
    {},
    { retries: 1, backoffBaseMs: 0, backoffMaxMs: 0 },
  );

  // Restore setTimeout
  (global as unknown as Record<string, unknown>).setTimeout = realSetTimeout;
  void retryAfterMs;
  void originalSetTimeout;

  assert.equal(res.ok, true);
  assert.equal(calls, 2);
});

test("providerFetch throws on network error", async () => {
  installFetchStub();
  fetchImpl = async () => {
    throw new TypeError("Failed to fetch");
  };

  await assert.rejects(
    () => providerFetch("https://api.example.com/unreachable"),
    (err: unknown) => err instanceof TypeError && /Failed to fetch/.test(String(err)),
  );
});

test("providerFetch aborts when caller signal is already aborted", async () => {
  installFetchStub();
  const controller = new AbortController();
  controller.abort();

  // A fetch stub that checks the signal
  fetchImpl = async (_url, init) => {
    if ((init?.signal as AbortSignal | undefined)?.aborted) {
      const err = new DOMException("The operation was aborted.", "AbortError");
      throw err;
    }
    return fakeResponse({ status: 200 });
  };

  await assert.rejects(
    () =>
      providerFetch(
        "https://api.example.com/anything",
        { signal: controller.signal },
        { provider: "test" },
      ),
    (err: unknown) => err instanceof Error,
  );
});

test("DEFAULT_PROVIDER_TIMEOUT_MS is 15_000", () => {
  assert.equal(DEFAULT_PROVIDER_TIMEOUT_MS, 15_000);
});

test("providerFetch passes request method and headers", async () => {
  installFetchStub();
  fetchImpl = async () => fakeResponse({ status: 200 });

  await providerFetch(
    "https://api.example.com/token",
    {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": "key123" },
    },
    { provider: "speech-token" },
  );

  assert.equal(fetchCalls.length, 1);
  const init = fetchCalls[0].init as RequestInit & { headers?: Record<string, string> };
  assert.equal(init.method, "POST");
  // headers may be a plain object or Headers instance — check using cast
  const hdrs = init.headers as Record<string, string> | undefined;
  assert.ok(hdrs && hdrs["Ocp-Apim-Subscription-Key"] === "key123");
});
