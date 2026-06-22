import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  postJson,
  getJson,
  ApiResponseError,
  DEFAULT_TIMEOUT_MS,
} from "@/lib/client-fetch";

type FetchCall = { url: string; init: RequestInit };

const realFetch = globalThis.fetch;
let calls: FetchCall[] = [];

/** Install a stub fetch returning the given response. */
function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>): void {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push({ url, init: init ?? {} });
    return impl(url, init ?? {});
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("postJson sends a JSON body and parses the JSON response", async () => {
  stubFetch(async () => jsonResponse({ ok: true, value: 42 }));
  const out = await postJson<{ ok: boolean; value: number }>("/api/x", { a: 1 });
  assert.deepEqual(out, { ok: true, value: 42 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body, JSON.stringify({ a: 1 }));
  assert.equal(
    (calls[0].init.headers as Record<string, string>)["Content-Type"],
    "application/json",
  );
});

test("getJson issues a GET and parses the JSON response", async () => {
  stubFetch(async () => jsonResponse({ items: [1, 2, 3] }));
  const out = await getJson<{ items: number[] }>("/api/y");
  assert.deepEqual(out, { items: [1, 2, 3] });
  assert.equal(calls[0].init.method, "GET");
});

test("non-OK response throws ApiResponseError with status + server message", async () => {
  stubFetch(async () => jsonResponse({ error: "Nope" }, 409));
  await assert.rejects(
    () => postJson("/api/z", {}),
    (err: unknown) => {
      assert.ok(err instanceof ApiResponseError);
      assert.equal(err.status, 409);
      assert.equal(err.message, "Nope");
      return true;
    },
  );
});

test("non-OK response without an error body falls back to a status message", async () => {
  stubFetch(async () => new Response("", { status: 500 }));
  await assert.rejects(
    () => getJson("/api/z"),
    (err: unknown) => {
      assert.ok(err instanceof ApiResponseError);
      assert.equal(err.status, 500);
      assert.match(err.message, /HTTP 500/);
      return true;
    },
  );
});

test("a caller-supplied aborted signal aborts the request", async () => {
  stubFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init.signal;
        if (signal?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => getJson("/api/slow", { signal: controller.signal }),
    (err: unknown) => err instanceof DOMException && err.name === "AbortError",
  );
});

test("DEFAULT_TIMEOUT_MS is a positive number", () => {
  assert.ok(DEFAULT_TIMEOUT_MS > 0);
});
