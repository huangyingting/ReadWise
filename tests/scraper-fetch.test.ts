/**
 * Tests for fetchHtml redirect handling (src/lib/scraper/fetch.ts).
 * The SSRF guard (resolveAndPin) and undici's fetch/Agent are mocked so no
 * DNS/network is touched. Verifies that EVERY redirect hop's host is
 * re-validated + IP-pinned through the SSRF guard (no DNS-rebinding / SSRF via
 * redirects) and that the hop count is bounded, while preserving the
 * timeout/UA/non-2xx behavior.
 */
process.env.LOG_LEVEL = "error";
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---- mutable state -------------------------------------------------------
let validated: string[] = [];
let fetchCalls: string[] = [];
let routes: Record<string, { status: number; location?: string; body?: string }> = {};

function isUnsafe(u: string): boolean {
  return /169\.254|127\.0|localhost|(^|\/)10\.|::1|metadata/i.test(u);
}

function fakeResponse(r: { status: number; location?: string; body?: string }): Response {
  return {
    status: r.status,
    ok: r.status >= 200 && r.status < 300,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "location" ? (r.location ?? null) : null,
    },
    text: async () => r.body ?? "",
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
        if (isUnsafe(u)) throw new Error(`private address blocked: ${u}`);
        return { ip: "93.184.216.34", family: 4 };
      },
      assertSafeUrl: async () => {},
      assertSafeHostname: async () => {},
      isPrivateAddress: () => false,
    },
  });

  // The scraper connects via undici's `fetch` with a per-request pinned
  // dispatcher (Agent). Mock both so no DNS/network/Agent is touched.
  mock.module("undici", {
    namedExports: {
      Agent: class {
        async close() {}
      },
      fetch: async (input: unknown): Promise<Response> => {
        const url = typeof input === "string" ? input : String(input);
        fetchCalls.push(url);
        const r = routes[url];
        if (!r) throw new Error(`no route configured for ${url}`);
        return fakeResponse(r);
      },
    },
  });
});

beforeEach(() => {
  validated = [];
  fetchCalls = [];
  routes = {};
});

test("fetchHtml rejects a redirect hop pointing at a private/metadata address", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  routes = {
    "https://safe.example/start": { status: 302, location: "http://169.254.169.254/latest/meta-data" },
  };
  await assert.rejects(fetchHtml("https://safe.example/start"), /private address blocked/);
  // Every hop is validated through the SSRF guard...
  assert.ok(validated.includes("https://safe.example/start"));
  assert.ok(validated.includes("http://169.254.169.254/latest/meta-data"));
  // ...and the unsafe target is NEVER actually fetched.
  assert.deepEqual(fetchCalls, ["https://safe.example/start"]);
});

test("fetchHtml follows a safe redirect chain and validates each hop", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  routes = {
    "https://safe.example/start": { status: 301, location: "https://safe2.example/page" },
    "https://safe2.example/page": { status: 200, body: "HELLO" },
  };
  const html = await fetchHtml("https://safe.example/start");
  assert.equal(html, "HELLO");
  assert.deepEqual(validated, ["https://safe.example/start", "https://safe2.example/page"]);
});

test("fetchHtml resolves relative redirect Location against the current URL", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  routes = {
    "https://safe.example/start": { status: 302, location: "/moved" },
    "https://safe.example/moved": { status: 200, body: "MOVED" },
  };
  const html = await fetchHtml("https://safe.example/start");
  assert.equal(html, "MOVED");
  assert.ok(validated.includes("https://safe.example/moved"));
});

test("fetchHtml bounds the number of redirects", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  // A redirect loop that always points to the next safe hop.
  routes = {};
  for (let i = 0; i <= 10; i++) {
    routes[`https://safe.example/r${i}`] = {
      status: 302,
      location: `https://safe.example/r${i + 1}`,
    };
  }
  await assert.rejects(fetchHtml("https://safe.example/r0"), /Too many redirects/);
});

test("fetchHtml rejects a non-2xx final response", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  routes = { "https://safe.example/missing": { status: 404 } };
  await assert.rejects(fetchHtml("https://safe.example/missing"), /HTTP 404/);
});

test("fetchHtml makes a single origin request for a plain 200 (chain stays dormant)", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  routes = { "https://safe.example/ok": { status: 200, body: "PLAIN-OK" } };
  const html = await fetchHtml("https://safe.example/ok");
  assert.equal(html, "PLAIN-OK");
  // No profile/reader/wayback fallbacks: exactly one underlying request.
  assert.deepEqual(fetchCalls, ["https://safe.example/ok"]);
  assert.deepEqual(validated, ["https://safe.example/ok"]);
});
