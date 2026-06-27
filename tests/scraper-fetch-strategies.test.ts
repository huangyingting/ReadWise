/**
 * Tests for the multi-strategy fetch fallback chain
 * (src/lib/scraper/fetch-strategies.ts, wired into fetchHtml).
 *
 * The SSRF guard (resolveAndPin / assertSafeUrl) and undici's fetch/Agent are
 * mocked so no DNS/network is touched. We drive the chain by configuring HTTP
 * statuses per URL (`routes`) and assert which strategies are attempted, in
 * what order, that a bot-challenge advances the chain while a genuine 404 does
 * not, that SSRF still blocks BEFORE any fetch, that env flags gate each stage,
 * and that the per-host memory short-circuits to the winning strategy.
 *
 * Each test uses a UNIQUE host so the process-lifetime per-host strategy memory
 * never leaks across tests.
 */
process.env.LOG_LEVEL = "error";
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---- mutable state -------------------------------------------------------
let validated: string[] = [];
let fetchCalls: string[] = [];
let fetchHeaders: Record<string, string>[] = [];
type RouteResp = { status: number; location?: string; body?: string };
let routes: Record<string, RouteResp | RouteResp[]> = {};

function isUnsafe(u: string): boolean {
  return /169\.254|127\.0|localhost|(^|\/)10\.|::1|metadata|internal\./i.test(u);
}

function fakeResponse(r: RouteResp): Response {
  return {
    status: r.status,
    ok: r.status >= 200 && r.status < 300,
    headers: {
      get: (name: string) => (name.toLowerCase() === "location" ? (r.location ?? null) : null),
    },
    text: async () => r.body ?? "",
  } as unknown as Response;
}

/** Resolves the configured response for a URL; arrays are consumed in order (last sticks). */
function nextResponse(url: string): RouteResp | undefined {
  const entry = routes[url];
  if (Array.isArray(entry)) {
    return entry.length > 1 ? entry.shift() : entry[0];
  }
  return entry;
}

/** Per-test URL set built from a unique host. */
let seq = 0;
function urls(): { host: string; origin: string; reader: string; wayback: string } {
  seq += 1;
  const origin = `https://provider${seq}.example/article`;
  return {
    host: `provider${seq}.example`,
    origin,
    reader: `https://r.jina.ai/${origin}`,
    wayback: `https://web.archive.org/web/${new Date().getUTCFullYear()}id_/${origin}`,
  };
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
      assertSafeUrl: async (u: string) => {
        const parsed = new URL(u);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error(`Only http(s) URLs are allowed (got ${parsed.protocol})`);
        }
        if (isUnsafe(u)) {
          throw new Error(`Requests to private/internal addresses are not allowed (${u})`);
        }
      },
      assertSafeHostname: async () => {},
    },
  });

  mock.module("undici", {
    namedExports: {
      Agent: class {
        async close() {}
      },
      fetch: async (
        input: unknown,
        init?: { headers?: Record<string, string> },
      ): Promise<Response> => {
        const url = typeof input === "string" ? input : String(input);
        fetchCalls.push(url);
        fetchHeaders.push(init?.headers ?? {});
        const r = nextResponse(url);
        if (!r) throw new Error(`no route configured for ${url}`);
        return fakeResponse(r);
      },
    },
  });
});

beforeEach(() => {
  validated = [];
  fetchCalls = [];
  fetchHeaders = [];
  routes = {};
  delete process.env.SCRAPER_FETCH_PROFILE_RETRY;
  delete process.env.SCRAPER_FETCH_READER;
  delete process.env.SCRAPER_FETCH_WAYBACK;
  delete process.env.JINA_API_KEY;
});

test("a normal 200 origin fetch makes a single request and returns (backward compatible)", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  const u = urls();
  routes = { [u.origin]: { status: 200, body: "ORIGIN-OK" } };
  const html = await fetchHtml(u.origin);
  assert.equal(html, "ORIGIN-OK");
  assert.deepEqual(fetchCalls, [u.origin]);
});

test("origin 403 retries with browser profiles; first 200 profile wins", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  const u = urls();
  // Same URL answered in order: origin 403, googlebot 403, desktop-chrome 200.
  routes = {
    [u.origin]: [{ status: 403 }, { status: 403 }, { status: 200, body: "CHROME-OK" }],
  };
  const html = await fetchHtml(u.origin);
  assert.equal(html, "CHROME-OK");
  assert.deepEqual(fetchCalls, [u.origin, u.origin, u.origin]);
  // The 2nd attempt used the Googlebot profile (kept first for backward-compat).
  assert.match(fetchHeaders[1]["user-agent"], /Googlebot/);
  // The winning (3rd) attempt used the desktop-chrome UA + navigation headers.
  assert.match(fetchHeaders[2]["user-agent"], /Chrome\/124/);
  assert.equal(fetchHeaders[2]["sec-fetch-mode"], "navigate");
});

test("all profiles 403 → reader (r.jina.ai) is called with X-Return-Format html", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  const u = urls();
  routes = {
    [u.origin]: { status: 403 },
    [u.reader]: { status: 200, body: "READER-OK" },
  };
  const html = await fetchHtml(u.origin);
  assert.equal(html, "READER-OK");
  assert.ok(fetchCalls.includes(u.reader), "reader URL should be fetched");
  const readerIdx = fetchCalls.indexOf(u.reader);
  assert.equal(fetchHeaders[readerIdx]["x-return-format"], "html");
  // No JINA_API_KEY set → no Authorization header.
  assert.equal(fetchHeaders[readerIdx]["authorization"], undefined);
});

test("reader sends Bearer Authorization when JINA_API_KEY is set", async () => {
  process.env.JINA_API_KEY = "secret-token";
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  const u = urls();
  routes = {
    [u.origin]: { status: 403 },
    [u.reader]: { status: 200, body: "READER-OK" },
  };
  await fetchHtml(u.origin);
  const readerIdx = fetchCalls.indexOf(u.reader);
  assert.equal(fetchHeaders[readerIdx]["authorization"], "Bearer secret-token");
});

test("reader blocked → Wayback (/web/<year>id_/) is called and returns HTML", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  const u = urls();
  routes = {
    [u.origin]: { status: 403 },
    [u.reader]: { status: 403 },
    [u.wayback]: { status: 200, body: "WAYBACK-OK" },
  };
  const html = await fetchHtml(u.origin);
  assert.equal(html, "WAYBACK-OK");
  assert.ok(fetchCalls.includes(u.wayback), "wayback URL should be fetched");
  assert.match(u.wayback, /\/web\/\d{4}id_\//);
});

test("a genuine 404 does NOT trigger profile-retry/reader/wayback", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  const u = urls();
  routes = { [u.origin]: { status: 404 } };
  await assert.rejects(fetchHtml(u.origin), /HTTP 404/);
  // Only the single origin attempt; no profiles, no reader, no wayback.
  assert.deepEqual(fetchCalls, [u.origin]);
});

test("SSRF: an internal/private URL is rejected BEFORE any fetch (no reader/wayback)", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  routes = {};
  await assert.rejects(fetchHtml("https://internal.service/secret"), /private\/internal addresses/);
  // Nothing fetched at all — reader/wayback never built/invoked.
  assert.deepEqual(fetchCalls, []);
});

test("SCRAPER_FETCH_PROFILE_RETRY=false does only the single origin attempt", async () => {
  process.env.SCRAPER_FETCH_PROFILE_RETRY = "false";
  process.env.SCRAPER_FETCH_READER = "false";
  process.env.SCRAPER_FETCH_WAYBACK = "false";
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  const u = urls();
  routes = { [u.origin]: { status: 403 } };
  await assert.rejects(fetchHtml(u.origin), /HTTP 403/);
  assert.deepEqual(fetchCalls, [u.origin]);
});

test("SCRAPER_FETCH_READER=false skips reader (falls straight to wayback)", async () => {
  process.env.SCRAPER_FETCH_PROFILE_RETRY = "false";
  process.env.SCRAPER_FETCH_READER = "false";
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  const u = urls();
  routes = {
    [u.origin]: { status: 403 },
    [u.wayback]: { status: 200, body: "WAYBACK-OK" },
  };
  const html = await fetchHtml(u.origin);
  assert.equal(html, "WAYBACK-OK");
  assert.equal(fetchCalls.includes(u.reader), false, "reader must be skipped");
  assert.ok(fetchCalls.includes(u.wayback));
});

test("SCRAPER_FETCH_WAYBACK=false skips wayback", async () => {
  process.env.SCRAPER_FETCH_PROFILE_RETRY = "false";
  process.env.SCRAPER_FETCH_WAYBACK = "false";
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  const u = urls();
  routes = {
    [u.origin]: { status: 403 },
    [u.reader]: { status: 403 },
  };
  await assert.rejects(fetchHtml(u.origin), /HTTP 403/);
  assert.equal(
    fetchCalls.some((c) => c.startsWith("https://web.archive.org/")),
    false,
  );
  assert.ok(fetchCalls.includes(u.reader));
});

test("per-host memory: second call to a known-reader host tries reader first", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  const u = urls();
  // First call: origin + all profiles 403, reader 200 → remember "reader".
  routes = { [u.origin]: { status: 403 }, [u.reader]: { status: 200, body: "R1" } };
  const first = await fetchHtml(u.origin);
  assert.equal(first, "R1");
  assert.ok(fetchCalls.indexOf(u.reader) > 0, "reader should not be first on the initial call");

  // Second call (same host): reader should be attempted FIRST, before origin.
  fetchCalls = [];
  fetchHeaders = [];
  routes = { [u.origin]: { status: 403 }, [u.reader]: { status: 200, body: "R2" } };
  const second = await fetchHtml(u.origin);
  assert.equal(second, "R2");
  assert.equal(fetchCalls[0], u.reader, "reader must be the first attempt on the second call");
});

// ---- content-based bot-challenge detection (HTTP 200 interstitials) -------

const CLOUDFLARE_CHALLENGE =
  "<!DOCTYPE html><html><head><meta name=\"robots\" content=\"noindex,nofollow\">" +
  "<title>Just a moment...</title></head><body>" +
  "<div id=\"cf-challenge\">Checking your browser before accessing.</div>" +
  "</body></html>";

const VERCEL_CHALLENGE =
  "<!DOCTYPE html><html><head><title>Vercel Security Checkpoint</title></head>" +
  "<body><p>We're verifying your browser.</p></body></html>";

const REAL_ARTICLE =
  "<!DOCTYPE html><html><head><title>Real Article</title>" +
  "<meta property=\"og:title\" content=\"Real Article\"></head><body><article>" +
  "<h1>A genuine headline</h1>" +
  "<p>First paragraph of a real article with plenty of substantive text to read.</p>" +
  "<p>Second paragraph continues the discussion with even more detail and context.</p>" +
  "<p>Third paragraph wraps up the argument and offers a concluding thought.</p>" +
  "</article></body></html>";

// A genuinely SHORT but real article: <article> + a couple of paragraphs, no
// vendor strings — must NOT be misclassified as a challenge.
const SHORT_REAL_ARTICLE =
  "<!DOCTYPE html><html><head><title>Short Note</title></head><body><article>" +
  "<h1>Short note</h1><p>Brief but real content here.</p></article></body></html>";

test("a 200 Cloudflare 'Just a moment...' page escalates to the next strategy", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  const u = urls();
  // origin returns a 200 challenge; a later profile returns a real article.
  routes = {
    [u.origin]: [
      { status: 200, body: CLOUDFLARE_CHALLENGE },
      { status: 200, body: REAL_ARTICLE },
    ],
  };
  const html = await fetchHtml(u.origin);
  assert.equal(html, REAL_ARTICLE);
  // origin (challenge) then the next profile (real) → at least two attempts.
  assert.ok(fetchCalls.length >= 2, "challenge should have triggered escalation");
});

test("a 200 Vercel 'Security Checkpoint' page escalates and reader wins", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  const u = urls();
  routes = {
    [u.origin]: { status: 200, body: VERCEL_CHALLENGE },
    [u.reader]: { status: 200, body: REAL_ARTICLE },
  };
  const html = await fetchHtml(u.origin);
  assert.equal(html, REAL_ARTICLE);
  assert.ok(fetchCalls.includes(u.reader), "reader should be reached after the 200 challenge");
});

test("a real 200 article is NOT treated as a challenge (single attempt)", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  const u = urls();
  routes = { [u.origin]: { status: 200, body: REAL_ARTICLE } };
  const html = await fetchHtml(u.origin);
  assert.equal(html, REAL_ARTICLE);
  assert.deepEqual(fetchCalls, [u.origin], "real article must not escalate");
});

test("a SHORT but real 200 article is NOT treated as a challenge", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  const u = urls();
  routes = { [u.origin]: { status: 200, body: SHORT_REAL_ARTICLE } };
  const html = await fetchHtml(u.origin);
  assert.equal(html, SHORT_REAL_ARTICLE);
  assert.deepEqual(fetchCalls, [u.origin], "short real article must not escalate");
});

test("when ALL strategies return challenge bodies, the chain THROWS a blocked error", async () => {
  const { fetchHtml } = await import("@/lib/scraper/fetch");
  const u = urls();
  routes = {
    [u.origin]: { status: 200, body: CLOUDFLARE_CHALLENGE },
    [u.reader]: { status: 200, body: CLOUDFLARE_CHALLENGE },
    [u.wayback]: { status: 200, body: VERCEL_CHALLENGE },
  };
  await assert.rejects(fetchHtml(u.origin), /bot challenge not bypassed/);
  // It must NOT return the challenge HTML; reader + wayback were both tried.
  assert.ok(fetchCalls.includes(u.reader), "reader should be attempted");
  assert.ok(fetchCalls.includes(u.wayback), "wayback should be attempted");
});

test("looksLikeBotChallenge: vendor strings true, real article false, tiny+noindex true", async () => {
  const { looksLikeBotChallenge } = await import("@/lib/scraper/fetch-strategies");
  // Named vendor markers → true.
  assert.equal(looksLikeBotChallenge(CLOUDFLARE_CHALLENGE), true);
  assert.equal(looksLikeBotChallenge(VERCEL_CHALLENGE), true);
  assert.equal(looksLikeBotChallenge("<html><body>DataDome protection</body></html>"), true);
  assert.equal(
    looksLikeBotChallenge("<html><body>Pardon Our Interruption</body></html>"),
    true,
  );
  // Real articles → false (even short).
  assert.equal(looksLikeBotChallenge(REAL_ARTICLE), false);
  assert.equal(looksLikeBotChallenge(SHORT_REAL_ARTICLE), false);
  // Tiny body + noindex + no article markers → true.
  const tiny =
    "<html><head><meta name=\"robots\" content=\"noindex,nofollow\"></head>" +
    "<body>verifying</body></html>";
  assert.equal(looksLikeBotChallenge(tiny), true);
  // A bot-challenge STATUS still short-circuits to true regardless of body.
  assert.equal(looksLikeBotChallenge(REAL_ARTICLE, 403), true);
  // Empty / non-string → false.
  assert.equal(looksLikeBotChallenge(""), false);
});
