process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { buildArticle } from "./helpers";

let contentSources = new Map<string, Record<string, unknown>>();
let contentSourceFindManyArgs: unknown[] = [];
let contentSourceCreates: unknown[] = [];
let contentSourceUpdates: unknown[] = [];
let contentSourceUpserts: unknown[] = [];
let ingestionMetrics: unknown[] = [];

let feedArticles: ReturnType<typeof buildArticle>[] = [];
let feedProgress: Array<{ articleId: string; completed: boolean; percent: number }> = [];
let feedTags: Array<{ articleId: string; tag: { slug: string } }> = [];
let feedProfile: { completedAt: Date | null; englishLevel: string; topics: string[] } | null = null;
let feedWarnings: unknown[] = [];

before(() => {
  mock.module("@/lib/scraper/providers", {
    namedExports: {
      PROVIDERS: [
        {
          key: "valid-provider",
          name: "Valid Provider",
          seeds: ["https://valid.example/news"],
        },
        {
          key: "invalid-provider",
          name: "Invalid Provider",
          seeds: ["not a valid url"],
        },
      ],
    },
  });
  mock.module("@/lib/observability/logger", {
    namedExports: {
      getRequestId: () => null,
      createLogger: (name: string) => ({
        info: () => {},
        warn: (message: string, meta: unknown) => {
          if (name === "feed") feedWarnings.push({ message, meta });
        },
        error: () => {},
      }),
    },
  });
  mock.module("@/lib/metrics", {
    namedExports: {
      recordIngestionRun: (metric: unknown) => {
        ingestionMetrics.push(metric);
      },
    },
  });
  mock.module("next/cache", {
    namedExports: {
      unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
      revalidateTag: () => {},
    },
  });
  mock.module("@/lib/cache", {
    namedExports: {
      createTenantCachedListing: (fn: (...args: unknown[]) => unknown) => fn,
    },
  });
  mock.module("@/lib/article-library", {
    namedExports: {
      publicListableArticleWhere: (where: unknown = {}) => ({ visible: true, ...(where as object) }),
      toListingArticle: (article: unknown) => article,
    },
  });
  mock.module("@/lib/profile", {
    namedExports: {
      getProfile: async () => feedProfile,
      parseTopics: (topics: unknown) => (Array.isArray(topics) ? topics : []),
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        contentSource: {
          findUnique: async ({ where }: { where: { providerKey: string } }) =>
            contentSources.get(where.providerKey) ?? null,
          findMany: async (args: unknown) => {
            contentSourceFindManyArgs.push(args);
            return [...contentSources.values()];
          },
          create: async ({ data }: { data: Record<string, unknown> }) => {
            contentSourceCreates.push(data);
            const row = { id: `${data.providerKey}-id`, enabled: true, ...data };
            contentSources.set(String(data.providerKey), row);
            return row;
          },
          update: async ({ where, data }: { where: { providerKey: string }; data: Record<string, unknown> }) => {
            contentSourceUpdates.push({ where, data });
            const row = { ...(contentSources.get(where.providerKey) ?? {}), ...data, providerKey: where.providerKey };
            contentSources.set(where.providerKey, row);
            return row;
          },
          upsert: async ({ where, update, create }: { where: { providerKey: string }; update: Record<string, unknown>; create: Record<string, unknown> }) => {
            contentSourceUpserts.push({ where, update, create });
            const existing = contentSources.get(where.providerKey);
            const row = existing
              ? { ...existing, ...update }
              : { id: `${where.providerKey}-id`, enabled: true, ...create };
            contentSources.set(where.providerKey, row);
            return row;
          },
        },
        article: {
          findMany: async () => feedArticles,
        },
        readingProgress: {
          findMany: async ({ where }: { where?: { completed?: boolean } }) => {
            if (where?.completed === true) return feedProgress.filter((row) => row.completed);
            if (where?.completed === false) return feedProgress.filter((row) => !row.completed);
            return feedProgress;
          },
        },
        articleTag: {
          findMany: async () => feedTags,
        },
      },
    },
  });
});

beforeEach(() => {
  contentSources = new Map();
  contentSourceFindManyArgs = [];
  contentSourceCreates = [];
  contentSourceUpdates = [];
  contentSourceUpserts = [];
  ingestionMetrics = [];
  feedArticles = [];
  feedProgress = [];
  feedTags = [];
  feedProfile = null;
  feedWarnings = [];
});

test("content source sync and accessors honor existing rows and unsynced defaults", async () => {
  const {
    getContentSource,
    isProviderEnabled,
    listContentSources,
    setContentSourceEnabled,
    syncContentSources,
  } = await import("@/lib/scraper/sources");
  contentSources.set("valid-provider", {
    id: "existing",
    providerKey: "valid-provider",
    displayName: "Old",
    baseUrl: "https://old.example",
    enabled: false,
  });

  assert.deepEqual(await syncContentSources(), { created: 1, updated: 1, total: 2 });
  assert.equal(
    (contentSourceUpdates[0] as { data: { baseUrl: string | null } }).data.baseUrl,
    "https://valid.example",
  );
  assert.equal((contentSourceCreates[0] as { baseUrl: string | null }).baseUrl, null);
  assert.equal(await isProviderEnabled("valid-provider"), false);
  assert.equal(await isProviderEnabled("missing-provider"), true);
  assert.equal((await getContentSource("valid-provider"))?.displayName, "Valid Provider");
  assert.equal((await listContentSources()).length, 2);
  assert.equal(contentSourceFindManyArgs.length, 1);
  assert.equal(await setContentSourceEnabled("missing-provider", false), null);
  const updated = await setContentSourceEnabled("valid-provider", true);
  assert.equal(updated?.enabled, true);
});

test("recordCrawlRun upserts first-run counters, health, and coarse metrics", async () => {
  const { recordCrawlRun } = await import("@/lib/scraper/sources");

  const first = await recordCrawlRun(
    "new-provider",
    { discovered: 0, scraped: 0, failed: 0, duplicates: 0, rejected: 0 },
    new Date("2026-01-01T00:00:00Z"),
  );

  assert.equal(first.healthStatus, "degraded");
  assert.equal(first.consecutiveZeroDiscovery, 1);
  assert.deepEqual(ingestionMetrics[0], {
    provider: "new-provider",
    outcome: "empty",
    health: "degraded",
  });

  contentSources.set("new-provider", {
    ...first,
    consecutiveFailures: 2,
    consecutiveZeroDiscovery: 0,
    totalDiscovered: 4,
    totalScraped: 0,
    totalFailed: 1,
    totalDuplicates: 0,
    totalRejected: 0,
    lastDiscoveryCount: 4,
    lastError: "previous",
  });
  const failed = await recordCrawlRun("new-provider", {
    discovered: 3,
    scraped: 0,
    failed: 3,
    duplicates: 0,
    rejected: 0,
    error: "fetch failed",
  });
  assert.equal(failed.healthStatus, "failing");
  assert.equal((ingestionMetrics.at(-1) as { outcome: string }).outcome, "failed");
  assert.equal(contentSourceUpserts.length, 2);
});

test("feed scoring covers tag-only interest, no-level fallback, and fresh reasons", async () => {
  const { scoreArticle } = await import("@/lib/feed");
  const baseCtx = {
    userLevel: null,
    userLevelRank: null,
    topicSet: new Set(["robotics"]),
    tagSlugsForArticle: ["robotics", "robotics", "science"],
    completedIds: new Set<string>(),
    inProgressIds: new Set<string>(),
    now: new Date("2026-01-10T00:00:00Z"),
  };
  const tagged = scoreArticle(buildArticle({ id: "tagged", category: "business" }), baseCtx);
  assert.equal(tagged?.reason, "Matches your interests");

  const fresh = scoreArticle(
    buildArticle({ id: "fresh", category: null, difficulty: null, publishedAt: new Date("2026-01-09T00:00:00Z") }),
    { ...baseCtx, topicSet: new Set(), tagSlugsForArticle: [] },
  );
  assert.equal(fresh?.reason, "New article");
});

test("getPersonalizedFeed warns near cap and soft-penalizes only positive in-progress rows", async () => {
  const { getPersonalizedFeed } = await import("@/lib/feed");
  feedArticles = Array.from({ length: 160 }, (_, index) =>
    buildArticle({
      id: `article-${index}`,
      category: "science",
      difficulty: "B1",
      publishedAt: new Date(`2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`),
    }),
  );
  feedProfile = {
    completedAt: new Date("2026-01-01T00:00:00Z"),
    englishLevel: "B1",
    topics: ["science"],
  };
  feedProgress = [
    { articleId: "article-1", completed: false, percent: 0 },
    { articleId: "article-2", completed: false, percent: 25 },
  ];
  feedTags = [{ articleId: "article-0", tag: { slug: "science" } }];

  const page = await getPersonalizedFeed("user-1", { limit: 5 });

  assert.equal(page.articles.length, 5);
  assert.equal(feedWarnings.length, 1);
  assert.equal(page.articles.every((article) => typeof article.id === "string"), true);
  assert.equal(page.hasMore, true);
});

test("discoverLinks and seed discovery skip malformed URLs and disallowed pages", async () => {
  const { discoverLinks, discoverProviderUrls } = await import("@/lib/scraper/discovery");
  const provider = {
    key: "demo",
    name: "Demo",
    hostnames: ["demo.example"],
    seeds: ["https://demo.example/seed"],
    articleUrlPattern: /^https:\/\/demo\.example\/article\/[a-z0-9-]+$/i,
    articleUrlFilter: (url: string) => !url.includes("blocked"),
    defaultCategory: "science",
    paginateSeed: (seed: string, page: number) => `${seed}?page=${page}`,
    maxSeedPages: 3,
  };

  assert.deepEqual(
    discoverLinks(
      provider,
      `<a href="/article/one#frag">One</a><a href="http://[::1">Bad</a><a href="https://other.example/article/two">Other</a>`,
      "https://demo.example/seed",
    ),
    ["https://demo.example/article/one"],
  );

  const urls = await discoverProviderUrls(provider, 3, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async (url) => !url.includes("page=2") && !url.includes("disallowed"),
    fetchHtml: async (url) => {
      if (url.endsWith("/seed")) {
        return `<a href="/article/one">One</a><a href="/article/disallowed">No</a>`;
      }
      if (url.includes("page=3")) return "<p>No links here</p>";
      throw new Error(`should not fetch disallowed page ${url}`);
    },
  });
  assert.deepEqual(urls, ["https://demo.example/article/one"]);
});

test("discoverProviderUrls filters extractor candidates after fetch helper use", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/discovery");
  const provider = {
    key: "extractor-demo",
    name: "Extractor Demo",
    hostnames: ["demo.example"],
    seeds: [],
    articleUrlPattern: /^https:\/\/demo\.example\/article\/[a-z0-9-]+$/i,
    articleUrlFilter: (url: string) => !url.includes("filtered"),
    defaultCategory: "science",
    urlExtractor: async ({ fetch }: { fetch: (url: string, init?: { method?: string }) => Promise<string> }) => {
      assert.equal(await fetch("https://demo.example/api", { method: "POST" }), "payload");
      return [
        "not a url",
        "https://other.example/article/one",
        "https://demo.example/not-article",
        "https://demo.example/article/filtered",
        "https://demo.example/article/disallowed",
        "https://demo.example/article/kept#section",
        "https://demo.example/article/kept",
      ];
    },
  };

  const urls = await discoverProviderUrls(provider, 5, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async (url) => !url.includes("disallowed"),
    extractorFetch: async () => "payload",
  });

  assert.deepEqual(urls, ["https://demo.example/article/kept"]);
});
