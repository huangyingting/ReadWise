/**
 * Tests for the discovery response-metadata fetch seam (issue #1084):
 * `fetchDiscoveryResponse` in src/lib/scraper/fetch.ts.
 *
 * The SSRF guard (`resolveAndPin`), undici's `fetch`/`Agent`, and the scraper
 * logger are all mocked so NO DNS/network is touched and log output can be
 * inspected for redaction. These tests prove the new response-returning path
 * reuses the SAME safe hop loop as the body-only `fetchCore` (per-hop
 * pinning/redirect validation) while surfacing typed outcomes and never leaking
 * credential-bearing URLs or request auth headers.
 */
process.env.LOG_LEVEL = "error";
process.env.SCRAPER_MAX_BYTES = "256";
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---- mutable state -------------------------------------------------------
type Route = {
  status: number;
  location?: string;
  headers?: Record<string, string>;
  body?: string;
  bodyBytes?: Uint8Array;
};

let validated: string[] = [];
let fetchCalls: string[] = [];
let requestInits: Array<{ url: string; headers: Record<string, string> }> = [];
let routes: Record<string, Route> = {};
let logs: Array<{ level: string; msg: string; meta: unknown }> = [];

function isUnsafe(u: string): boolean {
  return /169\.254|127\.0|localhost|(^|\/)10\.|::1|metadata/i.test(u);
}

function fakeResponse(r: Route): Response {
  const headerMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.headers ?? {})) headerMap[k.toLowerCase()] = v;
  if (r.location) headerMap["location"] = r.location;
  return {
    status: r.status,
    ok: r.status >= 200 && r.status < 300,
    headers: {
      get: (name: string) => headerMap[name.toLowerCase()] ?? null,
    },
    text: async () => r.body ?? "",
    body: r.bodyBytes
      ? new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(r.bodyBytes as Uint8Array);
            controller.close();
          },
        })
      : r.body !== undefined
        ? new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(r.body));
              controller.close();
            },
          })
        : undefined,
  } as unknown as Response;
}

before(() => {
  mock.module("@/lib/scraper/ssrf", {
    namedExports: {
      resolveAndPin: async (u: string) => {
        validated.push(u);
        const parsed = new URL(u);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error(`bad scheme: ${parsed.protocol}`);
        }
        // Reject on the raw target so a private redirect hop is blocked BEFORE
        // any request is made — never echo the secret query string.
        if (isUnsafe(u)) throw new Error(`private address blocked: ${parsed.hostname}`);
        return { ip: "93.184.216.34", family: 4 };
      },
      assertSafeUrl: async () => {},
      assertSafeHostname: async () => {},
      isPrivateAddress: () => false,
    },
  });

  mock.module("undici", {
    namedExports: {
      Agent: class {
        async close() {}
      },
      fetch: async (input: unknown, init?: { headers?: Record<string, string> }): Promise<Response> => {
        const url = typeof input === "string" ? input : String(input);
        fetchCalls.push(url);
        requestInits.push({ url, headers: { ...(init?.headers ?? {}) } });
        const r = routes[url];
        if (!r) throw new Error(`no route configured for ${url}`);
        return fakeResponse(r);
      },
    },
  });

  mock.module("@/lib/observability/logger", {
    namedExports: {
      createLogger: () => ({
        debug: (msg: string, meta?: unknown) => logs.push({ level: "debug", msg, meta }),
        info: (msg: string, meta?: unknown) => logs.push({ level: "info", msg, meta }),
        warn: (msg: string, meta?: unknown) => logs.push({ level: "warn", msg, meta }),
        error: (msg: string, meta?: unknown) => logs.push({ level: "error", msg, meta }),
      }),
      getRequestId: () => undefined,
      getRequestContext: () => undefined,
      setRequestContext: () => {},
      runWithRequestContext: <T>(_ctx: unknown, fn: () => T) => fn(),
    },
  });
});

beforeEach(() => {
  validated = [];
  fetchCalls = [];
  requestInits = [];
  routes = {};
  logs = [];
});

function allLogText(): string {
  return logs.map((l) => `${l.msg} ${JSON.stringify(l.meta)}`).join("\n");
}

test("sends conditional request headers (If-None-Match / If-Modified-Since)", async () => {
  const { fetchDiscoveryResponse } = await import("@/lib/scraper/fetch");
  routes = { "https://safe.example/feed": { status: 200, body: "OK" } };

  await fetchDiscoveryResponse("https://safe.example/feed", {
    ifNoneMatch: '"abc123"',
    ifModifiedSince: "Wed, 21 Oct 2026 07:28:00 GMT",
  });

  assert.equal(requestInits.length, 1);
  assert.equal(requestInits[0].headers["if-none-match"], '"abc123"');
  assert.equal(requestInits[0].headers["if-modified-since"], "Wed, 21 Oct 2026 07:28:00 GMT");
});

test("returns 304 as a typed no-body not-modified result (not a throw)", async () => {
  const { fetchDiscoveryResponse } = await import("@/lib/scraper/fetch");
  routes = {
    "https://safe.example/feed": {
      status: 304,
      headers: { etag: '"v2"', "last-modified": "Wed, 21 Oct 2026 07:28:00 GMT" },
    },
  };

  const res = await fetchDiscoveryResponse("https://safe.example/feed", { ifNoneMatch: '"v2"' });

  assert.equal(res.outcome, "not-modified");
  if (res.outcome !== "not-modified") return;
  assert.equal(res.status, 304);
  assert.equal(res.notModified, true);
  assert.equal(res.finalUrl, "https://safe.example/feed");
  assert.equal(res.validators.etag, '"v2"');
  assert.equal(res.validators.lastModified, "Wed, 21 Oct 2026 07:28:00 GMT");
  assert.ok(!("body" in res));
});

test("returns 200 with bounded body, final URL, validators, and allowlisted headers", async () => {
  const { fetchDiscoveryResponse } = await import("@/lib/scraper/fetch");
  routes = {
    "https://safe.example/feed": {
      status: 200,
      body: "<rss/>",
      headers: {
        etag: '"v9"',
        "last-modified": "Tue, 01 Jan 2026 00:00:00 GMT",
        "content-type": "application/rss+xml; charset=utf-8",
        "set-cookie": "session=SECRET",
      },
    },
  };

  const res = await fetchDiscoveryResponse("https://safe.example/feed");

  assert.equal(res.outcome, "ok");
  if (res.outcome !== "ok") return;
  assert.equal(res.status, 200);
  assert.equal(res.body, "<rss/>");
  assert.equal(res.finalUrl, "https://safe.example/feed");
  assert.equal(res.validators.etag, '"v9"');
  assert.equal(res.headers.contentType, "application/rss+xml; charset=utf-8");
  // Only the allowlisted content header is exposed — no cookies / arbitrary headers.
  assert.deepEqual(Object.keys(res.headers), ["contentType"]);
  assert.ok(!JSON.stringify(res).includes("SECRET"));
});

test("captures the final URL after a validated redirect chain", async () => {
  const { fetchDiscoveryResponse } = await import("@/lib/scraper/fetch");
  routes = {
    "https://safe.example/start": { status: 301, location: "https://safe2.example/final" },
    "https://safe2.example/final": { status: 200, body: "DONE" },
  };

  const res = await fetchDiscoveryResponse("https://safe.example/start");

  assert.equal(res.outcome, "ok");
  if (res.outcome !== "ok") return;
  assert.equal(res.finalUrl, "https://safe2.example/final");
  // Every hop was validated + pinned through the SSRF guard (shared hop loop).
  assert.deepEqual(validated, ["https://safe.example/start", "https://safe2.example/final"]);
});

test("parses Retry-After for a retryable 429 status", async () => {
  const { fetchDiscoveryResponse } = await import("@/lib/scraper/fetch");
  routes = {
    "https://safe.example/feed": { status: 429, headers: { "retry-after": "12" } },
  };

  const res = await fetchDiscoveryResponse("https://safe.example/feed");

  assert.equal(res.outcome, "retryable");
  if (res.outcome !== "retryable") return;
  assert.equal(res.status, 429);
  assert.equal(res.retryAfterMs, 12000);
});

test("classifies 503 as retryable and 404 as a typed error", async () => {
  const { fetchDiscoveryResponse } = await import("@/lib/scraper/fetch");
  routes = {
    "https://safe.example/down": { status: 503 },
    "https://safe.example/missing": { status: 404 },
  };

  const down = await fetchDiscoveryResponse("https://safe.example/down");
  assert.equal(down.outcome, "retryable");

  const missing = await fetchDiscoveryResponse("https://safe.example/missing");
  assert.equal(missing.outcome, "error");
  if (missing.outcome !== "error") return;
  assert.equal(missing.status, 404);
});

test("rejects an oversized body (streaming size cap enforced)", async () => {
  const { fetchDiscoveryResponse } = await import("@/lib/scraper/fetch");
  routes = {
    "https://safe.example/big": { status: 200, bodyBytes: new Uint8Array(300).fill(65) },
  };

  await assert.rejects(fetchDiscoveryResponse("https://safe.example/big"), /Response too large/);
});

test("surfaces a redirect to a private/SSRF address as a typed blocked outcome (no leak)", async () => {
  const { fetchDiscoveryResponse } = await import("@/lib/scraper/fetch");
  routes = {
    "https://safe.example/start": {
      status: 302,
      location: "http://169.254.169.254/latest/meta-data?token=SUPERSECRET",
    },
  };

  const res = await fetchDiscoveryResponse("https://safe.example/start");

  assert.equal(res.outcome, "blocked");
  if (res.outcome !== "blocked") return;
  assert.equal(res.reason, "unsafe-address");
  // Blocked outcome carries NO url/finalUrl and does not leak the target secret.
  assert.ok(!("finalUrl" in res));
  assert.ok(!JSON.stringify(res).includes("SUPERSECRET"));
  assert.ok(!JSON.stringify(res).includes("169.254"));
  // The unsafe target was validated (and rejected) but NEVER fetched.
  assert.ok(validated.includes("http://169.254.169.254/latest/meta-data?token=SUPERSECRET"));
  assert.deepEqual(fetchCalls, ["https://safe.example/start"]);
  // Logs redact the request URL and never contain the target secret.
  assert.ok(!allLogText().includes("SUPERSECRET"));
});

test("bounds the redirect chain with a typed blocked outcome", async () => {
  const { fetchDiscoveryResponse } = await import("@/lib/scraper/fetch");
  routes = {};
  for (let i = 0; i <= 10; i++) {
    routes[`https://safe.example/r${i}`] = { status: 302, location: `https://safe.example/r${i + 1}` };
  }

  const res = await fetchDiscoveryResponse("https://safe.example/r0");

  assert.equal(res.outcome, "blocked");
  if (res.outcome !== "blocked") return;
  assert.equal(res.reason, "too-many-redirects");
});

test("never leaks credential-bearing request URLs or auth headers to logs", async () => {
  const { fetchDiscoveryResponse } = await import("@/lib/scraper/fetch");
  const signedUrl = "https://safe.example/feed?sig=SIGSECRET&token=TOKENSECRET";
  routes = { [signedUrl]: { status: 302, location: "http://127.0.0.1/internal" } };

  const res = await fetchDiscoveryResponse(signedUrl, {
    headers: { authorization: "Bearer AUTHSECRET" },
  });

  assert.equal(res.outcome, "blocked");
  // The auth header WAS sent on the wire but must never appear in any log.
  assert.equal(requestInits[0].headers["authorization"], "Bearer AUTHSECRET");
  const text = allLogText();
  assert.ok(!text.includes("AUTHSECRET"), "auth header leaked to log");
  assert.ok(!text.includes("SIGSECRET"), "signed query leaked to log");
  assert.ok(!text.includes("TOKENSECRET"), "token query leaked to log");
  // A blocked log entry exists, and its url is redacted (query stripped).
  const blocked = logs.find((l) => l.msg === "discovery.fetch.blocked");
  assert.ok(blocked, "expected a blocked log entry");
  assert.equal((blocked!.meta as { url: string }).url, "https://safe.example/feed?[redacted]");
});

test("does NOT run the bot-challenge strategy rotation (single origin request)", async () => {
  const { fetchDiscoveryResponse } = await import("@/lib/scraper/fetch");
  // 403 would trigger the strategy chain for fetchHtml; the discovery path must
  // simply report it as a typed retryable/error outcome with ONE request.
  routes = { "https://safe.example/blocked": { status: 403 } };

  const res = await fetchDiscoveryResponse("https://safe.example/blocked");

  assert.equal(res.outcome, "error");
  assert.deepEqual(fetchCalls, ["https://safe.example/blocked"]);
});
