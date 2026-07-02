process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

class MockFetchHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(status: number, retryAfterMs?: number) {
    super(`HTTP ${status}`);
    this.name = "FetchHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

let fetchCoreImpl: (url: string) => Promise<string>;
let browserEnabled = false;
let readerEnabled = false;
let retryCount = 0;
let retryBaseMs = 0;
let retryMaxMs = 0;
let browserStatus = 200;
let browserHtml = "<article><p>rendered page</p><p>with body</p><p>and paragraphs</p></article>";

before(() => {
  mock.module("@/lib/scraper/fetch", {
    namedExports: {
      FetchHttpError: MockFetchHttpError,
      fetchCore: (url: string) => fetchCoreImpl(url),
    },
  });
  mock.module("@/lib/scraper/fetch-browser", {
    namedExports: {
      renderViaBrowser: async () => ({ status: browserStatus, html: browserHtml }),
    },
  });
  mock.module("@/lib/scraper/ssrf", {
    namedExports: {
      assertSafeUrl: async () => {},
    },
  });
  mock.module("@/lib/scraper/limits", {
    namedExports: {
      scraperTimeoutMs: () => 50,
    },
  });
  mock.module("@/lib/runtime-config/scraper", {
    namedExports: {
      scraperFetch429BaseMs: () => retryBaseMs,
      scraperFetch429MaxMs: () => retryMaxMs,
      scraperFetch429Retries: () => retryCount,
      scraperFetchBrowser: () => browserEnabled,
      scraperFetchProfileRetry: () => false,
      scraperFetchReader: () => readerEnabled,
      scraperFetchWayback: () => false,
    },
  });
  mock.module("@/lib/observability/logger", {
    namedExports: {
      createLogger: () => ({
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      }),
    },
  });
});

beforeEach(() => {
  browserEnabled = false;
  readerEnabled = false;
  retryCount = 0;
  retryBaseMs = 0;
  retryMaxMs = 0;
  browserStatus = 200;
  browserHtml = "<article><p>rendered page</p><p>with body</p><p>and paragraphs</p></article>";
  fetchCoreImpl = async () => "<article><p>origin page</p><p>with body</p><p>and paragraphs</p></article>";
});

test("browser strategy maps not-found and rate-limit render statuses to fetch errors", async () => {
  const { fetchHtmlWithStrategies } = await import("@/lib/scraper/fetch-strategies");
  browserEnabled = true;
  fetchCoreImpl = async () => {
    throw new MockFetchHttpError(403);
  };

  browserStatus = 410;
  await assert.rejects(
    () => fetchHtmlWithStrategies("https://browser-status.example/article", 50),
    (err: unknown) => err instanceof MockFetchHttpError && err.status === 410,
  );

  browserStatus = 429;
  await assert.rejects(
    () => fetchHtmlWithStrategies("https://browser-status.example/article-2", 50),
    (err: unknown) => err instanceof MockFetchHttpError,
  );
});

test("a remembered reader strategy can fail before any origin challenge is recorded", async () => {
  const { fetchHtmlWithStrategies } = await import("@/lib/scraper/fetch-strategies");
  readerEnabled = true;
  let readerShouldFail = false;

  fetchCoreImpl = async (url: string) => {
    if (url.startsWith("https://r.jina.ai/")) {
      if (readerShouldFail) throw new Error("reader unavailable");
      return "<article><p>reader page</p><p>with body</p><p>and paragraphs</p></article>";
    }
    throw new MockFetchHttpError(403);
  };

  assert.match(
    await fetchHtmlWithStrategies("https://remembered-reader.example/first", 50),
    /reader page/,
  );

  readerShouldFail = true;
  await assert.rejects(
    () => fetchHtmlWithStrategies("https://remembered-reader.example/second", 50),
    /reader unavailable/,
  );
});

test("strategy execution aborts when the overall deadline expires before an attempt", async (t) => {
  const { fetchHtmlWithStrategies } = await import("@/lib/scraper/fetch-strategies");
  const originalNow = Date.now;
  const times = [1000, 1001, 1005];
  Date.now = () => times.shift() ?? 1005;
  t.after(() => {
    Date.now = originalNow;
  });

  await assert.rejects(
    () => fetchHtmlWithStrategies("https://deadline-before.example/article", 1),
    /timed out before attempt: origin/,
  );
});

test("429 retry aborts when no deadline remains before delaying", async (t) => {
  const { fetchHtmlWithStrategies } = await import("@/lib/scraper/fetch-strategies");
  retryCount = 1;
  retryBaseMs = 1;
  retryMaxMs = 1;
  fetchCoreImpl = async () => {
    throw new MockFetchHttpError(429);
  };
  const originalNow = Date.now;
  const times = [1000, 1001, 1001, 1005];
  Date.now = () => times.shift() ?? 1005;
  t.after(() => {
    Date.now = originalNow;
  });

  await assert.rejects(
    () => fetchHtmlWithStrategies("https://deadline-retry.example/article", 1),
    (err: unknown) => err instanceof MockFetchHttpError && err.status === 429,
  );
});

test("429 retry aborts when the backoff would consume the remaining deadline", async (t) => {
  const { fetchHtmlWithStrategies } = await import("@/lib/scraper/fetch-strategies");
  retryCount = 1;
  retryBaseMs = 10;
  retryMaxMs = 10;
  fetchCoreImpl = async () => {
    throw new MockFetchHttpError(429);
  };
  const originalNow = Date.now;
  const times = [1000, 1000, 1000, 1003];
  Date.now = () => times.shift() ?? 1003;
  t.after(() => {
    Date.now = originalNow;
  });

  await assert.rejects(
    () =>
      fetchHtmlWithStrategies("https://deadline-clamped.example/article", 1, {
        random: () => 0,
      }),
    (err: unknown) => err instanceof MockFetchHttpError && err.status === 429,
  );
});
