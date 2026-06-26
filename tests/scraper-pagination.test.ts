/**
 * Tests for provider seed pagination in HTML discovery (#364).
 * No real network — injectable fetchHtml + allowedCheck.
 */
process.env.LOG_LEVEL = "error";

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

before(() => {
  mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
  mock.module("@/lib/scraper/sources", {
    namedExports: {
      isProviderEnabled: async () => true,
      syncContentSources: async () => {},
    },
  });
  mock.module("@/lib/scraper/robots", {
    namedExports: { isUrlAllowed: async () => true },
  });
  mock.module("@/lib/article-library", {
    namedExports: {
      findPublicLibraryArticleBySourceUrl: async () => null,
      PUBLIC_ARTICLE_CREATE_FIELDS: {},
    },
  });
  mock.module("@/lib/security/audit", {
    namedExports: { recordAuditFromRequest: async () => {} },
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePaginatedProvider(
  seeds: string[],
  maxSeedPages: number,
  paginateSeed: (seed: string, page: number) => string | null,
): import("@/lib/scraper/types").Provider {
  return {
    key: "paginated-test",
    name: "Paginated Test",
    hostnames: ["page.example.com", "www.page.example.com"],
    seeds,
    articleUrlPattern: /^https:\/\/(?:www\.)?page\.example\.com\/articles\/[a-z0-9-]+-\d+\/?$/i,
    defaultCategory: "world",
    maxSeedPages,
    paginateSeed,
  };
}

/** Builds a seed page HTML with `count` unique article links. */
function seedHtml(seed: string, page: number, count: number): string {
  return Array.from(
    { length: count },
    (_, i) =>
      `<a href="/articles/seed-${seed.replace(/\W+/g, "")}-page${page}-item${i + 1}-${page * 100 + i}">Story</a>`,
  ).join("\n");
}

// ---------------------------------------------------------------------------
// Pagination stop conditions
// ---------------------------------------------------------------------------

test("pagination: collects articles from multiple pages", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/discovery");

  const seed = "https://page.example.com/news";
  const provider = makePaginatedProvider(
    [seed],
    3,
    (s, p) => `${s}?page=${p}`,
  );

  const pages: Record<string, string> = {
    [seed]: seedHtml(seed, 1, 3),
    [`${seed}?page=2`]: seedHtml(seed, 2, 3),
    [`${seed}?page=3`]: seedHtml(seed, 3, 3),
  };

  const result = await discoverProviderUrls(provider, 20, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    fetchHtml: async (url) => pages[url] ?? "",
  });

  assert.equal(result.length, 9, "should collect 3 × 3 articles across 3 pages");
});

test("pagination: stops when limit is reached mid-pagination", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/discovery");

  const seed = "https://page.example.com/news";
  const provider = makePaginatedProvider([seed], 5, (s, p) => `${s}?page=${p}`);

  let fetchCount = 0;
  const fetchHtmlFn = async (url: string) => {
    fetchCount++;
    const pageNum = url.includes("?page=") ? Number(url.split("=")[1]) : 1;
    return seedHtml(seed, pageNum, 3);
  };

  await discoverProviderUrls(provider, 4, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    fetchHtml: fetchHtmlFn,
  });

  // limit=4 reached after page 2 (3 items each) — page 3 shouldn't be needed
  assert.ok(fetchCount <= 2, `expected ≤ 2 fetches for limit=4, got ${fetchCount}`);
});

test("pagination: stops at maxSeedPages regardless of content", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/discovery");

  const seed = "https://page.example.com/news";
  const provider = makePaginatedProvider([seed], 2, (s, p) => `${s}?page=${p}`);

  let fetchCount = 0;
  const fetchHtmlFn = async (url: string) => {
    fetchCount++;
    const pageNum = url.includes("?page=") ? Number(url.split("=")[1]) : 1;
    return seedHtml(seed, pageNum, 3);
  };

  await discoverProviderUrls(provider, 100, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    fetchHtml: fetchHtmlFn,
  });

  assert.equal(fetchCount, 2, "should stop at maxSeedPages=2");
});

test("pagination: stops after 2 consecutive empty pages", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/discovery");

  const seed = "https://page.example.com/news";
  const provider = makePaginatedProvider([seed], 10, (s, p) => `${s}?page=${p}`);

  let fetchCount = 0;
  const fetchHtmlFn = async (url: string) => {
    fetchCount++;
    const pageNum = url.includes("?page=") ? Number(url.split("=")[1]) : 1;
    if (pageNum <= 2) return seedHtml(seed, pageNum, 2);
    return ""; // empty pages 3+ trigger consecutive-empty stop
  };

  await discoverProviderUrls(provider, 100, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    fetchHtml: fetchHtmlFn,
  });

  // Pages 1+2 have content; pages 3+4 are empty → stop after 2 consecutive empties
  assert.equal(fetchCount, 4, "stops after 2 consecutive empty pages (2 content + 2 empty)");
});

test("pagination: robots check applied to every paginated seed URL", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/discovery");

  const seed = "https://page.example.com/news";
  const provider = makePaginatedProvider([seed], 3, (s, p) => `${s}?page=${p}`);

  const checkedUrls: string[] = [];
  const pages: Record<string, string> = {
    [seed]: seedHtml(seed, 1, 2),
    [`${seed}?page=2`]: seedHtml(seed, 2, 2),
    [`${seed}?page=3`]: seedHtml(seed, 3, 2),
  };

  await discoverProviderUrls(provider, 100, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async (url) => {
      checkedUrls.push(url);
      return true;
    },
    fetchHtml: async (url) => pages[url] ?? "",
  });

  // All 3 seed pages should have been robots-checked
  assert.ok(checkedUrls.includes(seed), "page 1 seed robots-checked");
  assert.ok(checkedUrls.includes(`${seed}?page=2`), "page 2 seed robots-checked");
  assert.ok(checkedUrls.includes(`${seed}?page=3`), "page 3 seed robots-checked");
});

test("pagination: robots-disallowed paginated seed URL skips that page", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/discovery");

  const seed = "https://page.example.com/news";
  const provider = makePaginatedProvider([seed], 3, (s, p) => `${s}?page=${p}`);

  const page2 = `${seed}?page=2`;
  const pages: Record<string, string> = {
    [seed]: seedHtml(seed, 1, 3),
    [page2]: seedHtml(seed, 2, 3), // will be robots-blocked
    [`${seed}?page=3`]: seedHtml(seed, 3, 3),
  };

  const result = await discoverProviderUrls(provider, 100, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async (url) => url !== page2,
    fetchHtml: async (url) => pages[url] ?? "",
  });

  // Page 2 is skipped (blocked) — result should come from pages 1 and 3
  // But after 2 consecutive empties the loop stops; page 2 blocked → empty → page 3
  // The consecutive-empty counter: page 2 blocked counts as "no new links" → 1 empty,
  // page 3 then delivers content → resets counter.
  const page2Items = result.filter((u) => u.includes("-page2-"));
  assert.equal(page2Items.length, 0, "page 2 articles should not appear");
});

test("pagination: paginateSeed returning null stops pagination for that seed", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/discovery");

  const seed = "https://page.example.com/news";
  const provider = makePaginatedProvider(
    [seed],
    5,
    (_s, p) => (p <= 2 ? `${seed}?page=${p}` : null), // returns URLs for pages 2-3, null for page 4+
  );

  let fetchCount = 0;
  const fetchHtmlFn = async (url: string) => {
    fetchCount++;
    const pageNum = url.includes("?page=") ? Number(url.split("=")[1]) : 1;
    return seedHtml(seed, pageNum, 2);
  };

  await discoverProviderUrls(provider, 100, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    fetchHtml: fetchHtmlFn,
  });

  // Page 1 = plain seed, page 2 = ?page=2, page 3 = ?page=3 — paginateSeed(seed, 3)=null → stop.
  // Pages fetched: 1 (plain) + 2 (?page=2) = 2 total.
  assert.equal(fetchCount, 2, "stops when paginateSeed returns null");
});

test("pagination: deduplicates articles found on multiple pages", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/discovery");

  const seed = "https://page.example.com/news";
  const provider = makePaginatedProvider([seed], 3, (s, p) => `${s}?page=${p}`);

  // Pages 1 and 2 have the same articles
  const sharedHtml = seedHtml(seed, 1, 3);
  const pages: Record<string, string> = {
    [seed]: sharedHtml,
    [`${seed}?page=2`]: sharedHtml, // duplicate content
    [`${seed}?page=3`]: seedHtml(seed, 3, 3),
  };

  const result = await discoverProviderUrls(provider, 100, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    fetchHtml: async (url) => pages[url] ?? "",
  });

  // 3 unique from p1, 0 new from p2 (duplicates), 3 new from p3 = 6 unique
  // But p2 having 0 new links triggers consecutive-empty counter; p3 resets it
  assert.equal(result.length, 6, "deduplicates across pages");
});
