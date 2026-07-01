process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import type { ArticleProcessResult } from "@/lib/processing/processor";
import type { CrawlRunOutcome } from "@/lib/scraper/sources";
import type { Provider } from "@/lib/scraper/types";
import type { SkillSummary } from "@/lib/learning/types";

const providers: Provider[] = [
  { key: "alpha", name: "Alpha", homepage: "https://alpha.test" } as unknown as Provider,
  { key: "beta", name: "Beta", homepage: "https://beta.test" } as unknown as Provider,
];

let revalidatedTags: string[] = [];
let revalidateThrows = false;
let unstableCacheCalls: Array<{ keyParts: string[]; tags: string[] }> = [];
let cacheLookups: string[] = [];
let cacheMisses: string[] = [];

let postgresEnabled = false;
let articleCount = 0;
let articleFindManyQueue: Record<string, unknown>[][] = [];
let postgresRows: Record<string, unknown>[] = [];
let postgresThrows = false;
let articleFindManyCalls: unknown[] = [];
let annotationHighlightRows: Array<{ articleId: string }> = [];
let annotationSavedWordRows: Array<{ articleId: string }> = [];

let highlightFindManyRows: Record<string, unknown>[] = [];
let highlightGroupRows: Array<{ articleId: string; _count: { id: number } }> = [];
let highlightCountQueue: number[] = [];
let highlightFindFirstRow: Record<string, unknown> | null = null;
let savedWordExisting: { id: string; dueAt: Date | null } | null = null;
let savedWordCreated: { id: string; dueAt: Date | null } = { id: "card-new", dueAt: null };
let updateHighlightResult: { ok: true; highlight: { id: string } } | { ok: false; error: string; status: number } = {
  ok: true,
  highlight: { id: "h1" },
};

let reminderRow: Record<string, unknown> | null = null;
let reminderRows: Record<string, unknown>[] = [];
let upsertedReminder: Record<string, unknown> = {};

let pronunciationCreated: Record<string, unknown> | null = null;
let pronunciationFindRows: Record<string, unknown>[] = [];
let pronunciationAgg: Record<string, unknown> = {
  _count: { id: 0 },
  _avg: { pronScore: null },
  _max: { pronScore: null },
};
let pronunciationMax: number | null = null;

let defaultDiscoveredUrls: string[] = [];
let defaultScrapeResult: unknown = { status: "failed", reason: "default", sourceUrl: "x" };
let defaultProcessResult: ArticleProcessResult | null = null;
let recordedCrawls: Array<{ providerKey: string; outcome: CrawlRunOutcome }> = [];
let recordCrawlThrows = false;
let resolvedArticleId: string | null = "existing-article";

let dashboardProfile: Record<string, unknown> | null = null;
let todayEnabled = false;
let inProgressEntries: Array<{ article: { id: string } }> = [];
let feedArticles: Array<{ id: string; title: string }> = [];

let skillProfile: { skills: SkillSummary[]; totalEvidence: number };
let coachConfidences = new Map<string, number>();
let weakWordCount = 0;
let dueCount = 0;
let totalSaved = 0;
let lowComprehensionCount = 0;
let assessedCount = 0;
let quizAgg = { _avg: { scorePct: null as number | null }, _count: { _all: 0 } };
let pronAgg = { _avg: { pronScore: null as number | null }, _count: { _all: 0 } };
let levelRecommendation: unknown = null;
let pickRows: Array<{ id: string; title: string }> = [];

function article(id: string, title = id): Record<string, unknown> {
  return {
    id,
    title,
    excerpt: `${title} excerpt`,
    content: `${title} content`,
    author: "Author",
    source: "Source",
    sourceUrl: `https://example.test/${id}`,
    status: "PUBLISHED",
    visibility: "PUBLIC",
    ownerId: null,
    publishedAt: new Date("2026-01-02T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function okProcess(articleId: string, ok = true): ArticleProcessResult {
  return {
    articleId,
    title: `Article ${articleId}`,
    published: true,
    ok,
    steps: [],
  };
}

function resetState(): void {
  revalidatedTags = [];
  revalidateThrows = false;
  unstableCacheCalls = [];
  cacheLookups = [];
  cacheMisses = [];
  postgresEnabled = false;
  articleCount = 0;
  articleFindManyQueue = [];
  postgresRows = [];
  postgresThrows = false;
  articleFindManyCalls = [];
  annotationHighlightRows = [];
  annotationSavedWordRows = [];
  highlightFindManyRows = [];
  highlightGroupRows = [];
  highlightCountQueue = [];
  highlightFindFirstRow = null;
  savedWordExisting = null;
  savedWordCreated = { id: "card-new", dueAt: null };
  updateHighlightResult = { ok: true, highlight: { id: "h1" } };
  reminderRow = null;
  reminderRows = [];
  upsertedReminder = {};
  pronunciationCreated = null;
  pronunciationFindRows = [];
  pronunciationAgg = {
    _count: { id: 0 },
    _avg: { pronScore: null },
    _max: { pronScore: null },
  };
  pronunciationMax = null;
  defaultDiscoveredUrls = [];
  defaultScrapeResult = { status: "failed", reason: "default", sourceUrl: "x" };
  defaultProcessResult = null;
  recordedCrawls = [];
  recordCrawlThrows = false;
  resolvedArticleId = "existing-article";
  dashboardProfile = null;
  todayEnabled = false;
  inProgressEntries = [];
  feedArticles = [];
  skillProfile = { skills: [], totalEvidence: 0 };
  coachConfidences = new Map();
  weakWordCount = 0;
  dueCount = 0;
  totalSaved = 0;
  lowComprehensionCount = 0;
  assessedCount = 0;
  quizAgg = { _avg: { scorePct: null }, _count: { _all: 0 } };
  pronAgg = { _avg: { pronScore: null }, _count: { _all: 0 } };
  levelRecommendation = null;
  pickRows = [];
}

before(() => {
  resetState();

  mock.module("next/cache", {
    namedExports: {
      unstable_cache: (
        fn: (...args: unknown[]) => unknown,
        keyParts: string[],
        opts: { tags: string[] },
      ) => {
        unstableCacheCalls.push({ keyParts, tags: opts.tags });
        return fn;
      },
      revalidateTag: (tag: string) => {
        if (revalidateThrows) throw new Error("outside request scope");
        revalidatedTags.push(tag);
      },
    },
  });
  mock.module("@/lib/metrics", {
    namedExports: {
      recordCacheLookup: (name: string) => cacheLookups.push(name),
      recordCacheMiss: (name: string) => cacheMisses.push(name),
    },
  });
  mock.module("@/lib/db-utils", {
    namedExports: {
      isPostgresDatabase: () => postgresEnabled,
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        $queryRaw: async () => {
          if (postgresThrows) throw new Error("pg failed");
          return postgresRows;
        },
        article: {
          count: async () => articleCount,
          findMany: async (args: unknown) => {
            articleFindManyCalls.push(args);
            return articleFindManyQueue.shift() ?? [];
          },
        },
        highlight: {
          findMany: async (args: { select?: unknown }) => {
            if (args.select && "articleId" in (args.select as Record<string, unknown>)) {
              return annotationHighlightRows;
            }
            return highlightFindManyRows;
          },
          groupBy: async () => highlightGroupRows,
          count: async () => highlightCountQueue.shift() ?? 0,
          findFirst: async () => highlightFindFirstRow,
        },
        savedWord: {
          findMany: async () => annotationSavedWordRows,
          findUnique: async () => savedWordExisting,
          create: async () => savedWordCreated,
          count: async (args: { where?: { OR?: unknown } }) =>
            args.where && "OR" in args.where ? dueCount : totalSaved,
        },
        reminderPreference: {
          findUnique: async () => reminderRow,
          findMany: async () => reminderRows,
          upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
            upsertedReminder = { ...args.create, ...args.update };
            return {
              enabled: true,
              preferredHour: upsertedReminder.preferredHour ?? null,
              quietHoursStart: upsertedReminder.quietHoursStart ?? null,
              quietHoursEnd: upsertedReminder.quietHoursEnd ?? null,
              timezone: upsertedReminder.timezone ?? null,
            };
          },
        },
        pronunciationAttempt: {
          create: async (args: { data: Record<string, unknown> }) => {
            pronunciationCreated = {
              id: "pa1",
              referenceText: args.data.referenceText,
              accuracyScore: args.data.accuracyScore,
              fluencyScore: args.data.fluencyScore,
              completenessScore: args.data.completenessScore,
              pronScore: args.data.pronScore,
              articleId: args.data.articleId ?? null,
              createdAt: new Date("2026-01-01T00:00:00Z"),
            };
            return pronunciationCreated;
          },
          findMany: async () => pronunciationFindRows,
          aggregate: async (args: Record<string, unknown>) =>
            "_count" in args
              ? pronunciationAgg
              : { _max: { pronScore: pronunciationMax } },
        },
        wordMastery: {
          count: async () => weakWordCount,
        },
        articleMastery: {
          count: async (args: { where?: { comprehensionScore?: unknown } }) =>
            args.where && "comprehensionScore" in args.where
              ? lowComprehensionCount
              : assessedCount,
        },
        quizAttempt: {
          aggregate: async () => quizAgg,
        },
      },
    },
  });
  mock.module("@/lib/article-library", {
    namedExports: {
      ARTICLE_STATUSES: ["DRAFT", "PUBLISHED", "ARCHIVED"],
      REVIEW_STATES: ["PENDING", "APPROVED", "REJECTED"],
      TAKEDOWN_STATES: ["NONE", "REQUESTED", "REMOVED"],
      articleAccessContext: (user: { id: string | null; role: string | null }) => ({
        userId: user.id,
        role: user.role,
      }),
      isArticleOperator: (access: { role?: string | null } | null) =>
        access?.role === "Admin" || access?.role === "System",
      readableArticleWhere: (access: unknown, where: unknown) => ({ access, where }),
      findPublicLibraryArticleBySourceUrl: async () =>
        resolvedArticleId ? { id: resolvedArticleId } : null,
      getBookmarkedArticleIds: async (_userId: string, ids: string[]) => new Set(ids.slice(0, 1)),
    },
  });
  mock.module("@/lib/annotations", {
    namedExports: {
      updateHighlight: async () => updateHighlightResult,
    },
  });
  mock.module("@/lib/scraper/providers", {
    namedExports: {
      PROVIDERS: providers,
      getProvider: (key: string) => providers.find((p) => p.key === key) ?? null,
    },
  });
  mock.module("@/lib/scraper/discovery", {
    namedExports: {
      discoverProviderUrls: async () => defaultDiscoveredUrls,
    },
  });
  mock.module("@/lib/scraper", {
    namedExports: {
      scrapeAndSave: async () => defaultScrapeResult,
    },
  });
  mock.module("@/lib/processing/processor", {
    namedExports: {
      processArticle: async () => defaultProcessResult,
    },
  });
  mock.module("@/lib/scraper/sources", {
    namedExports: {
      recordCrawlRun: async (providerKey: string, outcome: CrawlRunOutcome) => {
        if (recordCrawlThrows) throw new Error("crawl record failed");
        recordedCrawls.push({ providerKey, outcome });
      },
    },
  });
  mock.module("@/lib/engagement", {
    namedExports: {
      listInProgressArticles: async () => inProgressEntries,
      getProgressSummaries: async (_userId: string, ids: string[]) =>
        Object.fromEntries(ids.map((id) => [id, { percent: 50, completed: false }])),
      getStreakSummary: async () => ({ currentStreak: 1, longestStreak: 3 }),
    },
  });
  mock.module("@/lib/learning/quiz-mastery", {
    namedExports: {
      getQuizMastery: async () => ({ totalAttempts: 1, averageScore: 80 }),
    },
  });
  mock.module("@/lib/learning/flashcards", {
    namedExports: {
      getReviewSummary: async () => ({ dueCount: 2 }),
    },
  });
  mock.module("@/features/profile-preferences/repository", {
    namedExports: {
      getProfile: async () => dashboardProfile,
    },
  });
  mock.module("@/features/profile-preferences/schema", {
    namedExports: {
      parseTopics: (value: unknown) => (typeof value === "string" ? JSON.parse(value) : []),
    },
  });
  mock.module("@/lib/feed", {
    namedExports: {
      getPersonalizedFeed: async () => ({ articles: feedArticles, hasMore: true }),
    },
  });
  mock.module("@/lib/runtime-config/feature-flags", {
    namedExports: {
      isTodaySessionFeatureEnabled: () => todayEnabled,
    },
  });
  mock.module("@/lib/engagement/today-session", {
    namedExports: {
      loadTodayViewModel: async () => ({ status: "ready", localDate: "2026-07-01" }),
    },
  });
  mock.module("@/lib/learning/skill-mastery", {
    namedExports: {
      getSkillProfile: async () => skillProfile,
    },
  });
  mock.module("@/lib/learning/coach-memory", {
    namedExports: {
      coachMemorySkillConfidences: async () => coachConfidences,
    },
  });
  mock.module("@/lib/leveling", {
    namedExports: {
      getAdaptiveLevelRecommendation: async () => levelRecommendation,
    },
  });
  mock.module("@/lib/recommendations/picks", {
    namedExports: {
      listScoredPicksPage: async () => ({
        articles: pickRows,
        reasons: Object.fromEntries(pickRows.map((row) => [row.id, "because"])),
      }),
    },
  });
});

beforeEach(() => {
  resetState();
});

test("annotation queries trim capped pages and build per-article count maps", async () => {
  const {
    HIGHLIGHTS_ALL_HARD_CAP,
    getHighlightCounts,
    listAllUserHighlights,
    listAllUserHighlightsPage,
    listHighlights,
  } = await import("@/lib/annotations/queries");

  highlightFindManyRows = [{ id: "h1" }, { id: "h2" }];
  assert.deepEqual(await listHighlights("u1", "a1"), highlightFindManyRows);

  highlightFindManyRows = Array.from(
    { length: HIGHLIGHTS_ALL_HARD_CAP + 1 },
    (_, index) => ({ id: `h${index}`, article: { id: "a", title: "A" } }),
  );
  assert.equal((await listAllUserHighlights("u1")).length, HIGHLIGHTS_ALL_HARD_CAP);
  const page = await listAllUserHighlightsPage("u1");
  assert.equal(page.hasMore, true);
  assert.equal(page.highlights.length, HIGHLIGHTS_ALL_HARD_CAP);

  assert.deepEqual(await getHighlightCounts("u1", []), {});
  highlightGroupRows = [
    { articleId: "a1", _count: { id: 2 } },
    { articleId: "a2", _count: { id: 1 } },
  ];
  assert.deepEqual(await getHighlightCounts("u1", ["a1", "a2"]), { a1: 2, a2: 1 });
});

test("search providers cover registry swaps, postgres FTS success/failure, and annotation backfill", async () => {
  const { registerSearchProvider, resolveSearchProvider, searchReadableArticles } =
    await import("@/lib/search/providers");
  const custom = {
    name: "custom",
    search: async () => ({ articles: [article("custom", "Custom")], hasMore: false }),
  };
  registerSearchProvider(custom as never);
  assert.equal(resolveSearchProvider(), custom);
  assert.deepEqual((await searchReadableArticles("anything")).articles.map((a) => a.id), ["custom"]);

  const { PrismaArticleSearchProvider } = await import("@/lib/search/fulltext");
  const provider = new PrismaArticleSearchProvider();
  postgresEnabled = true;
  articleCount = 3;
  postgresRows = [article("pg", "Climate")];
  articleFindManyQueue = [
    [article("exact-title", "Climate")],
    [article("title", "Climate report")],
    [article("byline", "Byline")],
    [],
    [],
    [article("text", "Body")],
    [article("annotation", "Annotation")],
  ];
  annotationHighlightRows = [{ articleId: "annotation" }];
  annotationSavedWordRows = [{ articleId: "annotation" }];

  const result = await provider.search(" climate ", { limit: 10 }, { userId: "u1", role: "Reader" });
  assert.ok(result.articles.some((row) => row.id === "pg"));
  assert.ok(result.articles.some((row) => row.id === "annotation"));
  assert.equal(result.hasMore, false);

  postgresThrows = true;
  articleCount = 0;
  articleFindManyQueue = [[], [], [], [], [], [], []];
  await provider.search("climate", {}, { role: "Admin" });
  assert.ok(articleFindManyCalls.length > 0);

  assert.deepEqual(await provider.search("   "), { articles: [], hasMore: false });
});

test("admin article schemas reject long query strings and invalid statuses", async () => {
  const { ingestBody, parseAdminArticlesQuery, reviewBody, takedownBody } =
    await import("@/lib/admin/articles/schemas");

  assert.equal(ingestBody({ url: "https://example.test/a" }).ok, true);
  assert.equal(reviewBody({ tags: ["one"], status: "PUBLISHED" }).ok, true);
  assert.equal(takedownBody({ state: "REQUESTED" }).ok, true);
  assert.equal(parseAdminArticlesQuery(new URLSearchParams([["q", "x".repeat(201)]])).ok, false);
  assert.equal(parseAdminArticlesQuery(new URLSearchParams([["status", "bogus"]])).ok, false);
  assert.deepEqual(
    parseAdminArticlesQuery(new URLSearchParams([["status", "published"], ["page", "2"]])).ok,
    true,
  );
});

test("cache helpers cover disabled mode, safe revalidation, public tags, and tenant eviction", async () => {
  const cache = await import("@/lib/cache");

  process.env.READWISE_DISABLE_LISTING_CACHE = "1";
  const disabled = cache.createCachedListing(async (id: string) => `value:${id}`, ["disabled"], ["tag"]);
  assert.equal(await disabled("a"), "value:a");
  const disabledTenant = cache.createTenantCachedListing(async (tenant: string) => tenant, ["tenant"], "user");
  assert.equal(await disabledTenant("  "), "unknown");
  delete process.env.READWISE_DISABLE_LISTING_CACHE;

  const publicTenant = cache.createCachedListing(async () => "ok", ["enabled"], ["tag"]);
  assert.equal(await publicTenant(), "ok");
  assert.deepEqual(cache.tenantCacheKeyParts(["k"], "public", "ignored"), ["k"]);

  const tenantListing = cache.createTenantCachedListing(async (tenant: string) => tenant, ["many"], "org");
  for (let i = 0; i <= cache.MAX_TENANT_CACHE_SIZE; i++) {
    assert.equal(await tenantListing(`org-${i}`), `org-${i}`);
  }
  assert.equal(unstableCacheCalls.length, cache.MAX_TENANT_CACHE_SIZE + 2);

  revalidateThrows = true;
  cache.revalidateArticlesCache();
  cache.revalidateOrgCache("  ");
  cache.revalidateTagsCache();
  cache.revalidateUserCache("u1");
  assert.deepEqual(revalidatedTags, []);
  assert.ok(cacheLookups.length > 0);
  assert.ok(cacheMisses.length > 0);
});

test("reminder preferences cover invalid inputs, fallback timezone parsing, and accessors", async () => {
  const prefs = await import("@/lib/reminder-preferences");

  assert.equal(prefs.validateReminderPreference({ quietHoursStart: 22 }).ok, false);
  assert.equal(prefs.validateReminderPreference({ quietHoursEnd: "bad" }).ok, false);
  assert.equal(prefs.validateReminderPreference({ timezone: "x".repeat(65) }).ok, false);
  assert.deepEqual(
    prefs.validateReminderPreference({
      enabled: false,
      preferredHour: "8",
      quietHoursStart: "22",
      quietHoursEnd: 7,
      timezone: "  UTC  ",
    }),
    {
      ok: true,
      value: {
        enabled: false,
        preferredHour: 8,
        quietHoursStart: 22,
        quietHoursEnd: 7,
        timezone: "UTC",
      },
    },
  );
  assert.equal(prefs.localHourInTimeZone(new Date("2026-01-01T12:00:00Z"), "Not/AZone"), 12);
  assert.equal(prefs.shouldSendNow({ ...prefs.DEFAULT_REMINDER_PREFERENCE, preferredHour: 8 }, 9).reason, "not-preferred-hour");

  assert.deepEqual(await prefs.getReminderPreference("u1"), prefs.DEFAULT_REMINDER_PREFERENCE);
  reminderRows = [
    {
      userId: "u1",
      enabled: false,
      preferredHour: 8,
      quietHoursStart: 22,
      quietHoursEnd: 7,
      timezone: "UTC",
    },
  ];
  const map = await prefs.getReminderPreferenceMap(["u1"]);
  assert.equal(map.get("u1")?.enabled, false);
  const upserted = await prefs.upsertReminderPreference("u1", { preferredHour: 10 });
  assert.equal(upserted.preferredHour, 10);
});

test("pronunciation and review asset helpers cover validation edges and privacy-safe summaries", async () => {
  const pronunciation = await import("@/lib/pronunciation");
  await assert.rejects(
    () =>
      pronunciation.recordPronunciationAttempt("u1", {
        referenceText: "x".repeat(2001),
        accuracyScore: 90,
        fluencyScore: 90,
        completenessScore: 90,
        pronScore: 90,
      }),
    /at most 2000/,
  );
  pronunciationMax = null;
  const recorded = await pronunciation.recordPronunciationAttempt("u1", {
    referenceText: "  hello  ",
    accuracyScore: 90,
    fluencyScore: 91,
    completenessScore: 92,
    pronScore: 93,
  });
  assert.equal(recorded.best, null);
  assert.equal(pronunciationCreated?.referenceText, "hello");
  pronunciationAgg = { _count: { id: 2 }, _avg: { pronScore: 92.5 }, _max: { pronScore: 95 } };
  assert.equal((await pronunciation.getPronunciationHistory("u1", { limit: 500 })).averageScore, 93);

  const review = await import("@/lib/learning/review-assets");
  assert.equal(review.reviewCardFront("  a   b  "), "a b");
  highlightFindFirstRow = { id: "h1", quote: "   ", note: null, articleId: "a1" };
  assert.equal(await review.convertHighlightToReviewCard("u1", "h1"), null);
  highlightFindFirstRow = { id: "h2", quote: "A useful passage", note: "note", articleId: "a1" };
  savedWordExisting = { id: "existing", dueAt: new Date("2026-01-01T00:00:00Z") };
  assert.equal((await review.convertHighlightToReviewCard("u1", "h2"))?.created, false);
  savedWordExisting = null;
  assert.equal((await review.convertHighlightToReviewCard("u1", "h2"))?.cardId, "card-new");
  highlightCountQueue = [5, 2, 1];
  highlightGroupRows = [{ articleId: "a1", _count: { id: 3 } }];
  assert.deepEqual(await review.getReviewAssetSummary("u1", new Date("2026-01-08T00:00:00Z")), {
    totalHighlights: 5,
    notedHighlights: 2,
    weeklyHighlights: 1,
    articlesWithHighlights: 1,
  });
  const emptyReflection = await review.recordTodayReflection({
    userId: "u1",
    highlightId: "h1",
    sentence: "   ",
  });
  assert.equal(emptyReflection.ok, false);
  if (!emptyReflection.ok) assert.equal(emptyReflection.status, 400);
  const longReflection = await review.recordTodayReflection({
    userId: "u1",
    highlightId: "h1",
    sentence: "x".repeat(2001),
  });
  assert.equal(longReflection.ok, false);
  if (!longReflection.ok) assert.equal(longReflection.status, 400);
  updateHighlightResult = { ok: false, error: "not found", status: 404 };
  const missingReflection = await review.recordTodayReflection({
    userId: "u1",
    highlightId: "missing",
    sentence: "ok",
  });
  assert.equal(missingReflection.ok, false);
  if (!missingReflection.ok) assert.equal(missingReflection.status, 404);
});

test("provider client covers no-timeout signal, invalid URL logging, retry-after parsing, and retry fallback", async () => {
  const { providerFetch } = await import("@/lib/http/provider-client");
  const responses = [
    new Response(null, {
      status: 429,
      headers: { "Retry-After": new Date(Date.now() + 1000).toUTCString() },
    }),
    new Response(null, { status: 200 }),
    new Response(null, { status: 429, headers: { "Retry-After": "nonsense" } }),
    new Response(null, { status: 200 }),
    new Response(null, { status: 200 }),
  ];
  const sleeps: number[] = [];
  const urls: string[] = [];
  mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    return responses.shift()!;
  });

  assert.equal((await providerFetch("https://provider.test/a", {}, { retries: 1, sleep: async (ms) => { sleeps.push(ms); } })).status, 200);
  assert.equal((await providerFetch("https://provider.test/b", {}, { retries: 1, backoffBaseMs: 0, sleep: async (ms) => { sleeps.push(ms); } })).status, 200);
  assert.equal((await providerFetch("not a url", {}, { timeoutMs: 0 })).status, 200);
  assert.deepEqual(urls.at(-1), "not a url");
  assert.ok(sleeps.length >= 2);
});

test("seed orchestration covers provider resolution, scrape/enrich failures, duplicates, and crawl fallback", async () => {
  const { runSeed } = await import("@/lib/seed");
  const messages: string[] = [];
  const logger = {
    info: (msg: string) => messages.push(`info:${msg}`),
    warn: (msg: string) => messages.push(`warn:${msg}`),
    error: (msg: string) => messages.push(`error:${msg}`),
  };

  defaultDiscoveredUrls = ["https://alpha.test/a"];
  defaultScrapeResult = { status: "skipped" };
  defaultProcessResult = okProcess("existing-article", false);
  const duplicate = await runSeed({ providerKeys: ["alpha"], logger });
  assert.equal(duplicate.duplicates, 1);
  assert.equal(duplicate.failed, 1);

  defaultDiscoveredUrls = ["https://alpha.test/fail"];
  defaultScrapeResult = { status: "failed", reason: "blocked", sourceUrl: "x" };
  const failed = await runSeed({ providerKeys: [], logger });
  assert.equal(failed.failed, 1);

  const injected = await runSeed({
    providerKeys: ["all"],
    limit: 1,
    logger,
    deps: {
      discover: async () => ["https://seed.test/throw", "https://seed.test/null", "https://seed.test/error"],
      scrapeAndSave: async (url) => {
        if (url.endsWith("throw")) throw new Error("scrape boom");
        return { status: "saved", id: url, article: { title: url } } as never;
      },
      process: async (id) => {
        if (id.endsWith("null")) return null;
        if (id.endsWith("error")) throw new Error("process boom");
        return okProcess(id);
      },
      recordCrawl: async () => {
        throw new Error("record boom");
      },
      resolveArticleId: async () => "unused",
    },
  });
  assert.equal(injected.failed, 3);
  assert.ok(messages.some((msg) => msg.includes("Could not record crawl health")));

  recordCrawlThrows = true;
  defaultDiscoveredUrls = [];
  recordedCrawls = [];
  await runSeed({ providerKeys: ["missing"], logger });
  assert.equal(recordedCrawls.length, 0);
});

test("dashboard view model shapes profile fields and optional Today summary", async () => {
  dashboardProfile = {
    englishLevel: "B1",
    ageRange: null,
    gender: "female",
    topics: JSON.stringify(["science"]),
    dailyGoal: 20,
    completedAt: new Date().toISOString(),
  };
  inProgressEntries = [{ article: { id: "rail-1" } }];
  feedArticles = [{ id: "feed-1", title: "Feed" }];
  todayEnabled = true;

  const { loadDashboardViewModel } = await import("@/app/(app)/dashboard/view-model");
  const vm = await loadDashboardViewModel({ id: "u1", role: "Reader" as never }, "B1" as never);
  assert.deepEqual(vm.profile?.topics, ["science"]);
  assert.equal(vm.profile?.dailyGoal, 20);
  assert.equal(vm.hasTopics, true);
  assert.deepEqual(vm.feedIds, ["feed-1"]);
  assert.equal(vm.bookmarkedIds.has("rail-1"), true);
  assert.ok(vm.todaySummary);
});

test("study plan engine covers due-review starter, coach-memory skills, one-area summary, and reading recs", async () => {
  const { buildWeeklyPlan, gatherStudyDiagnostics, generateStudyPlan } =
    await import("@/lib/learning/study-plan");

  dueCount = 3;
  const starterItems = buildWeeklyPlan([], {
    skills: [],
    hasSkillEvidence: false,
    vocab: { weakCount: 0, dueCount: 3, totalSaved: 3 },
    quiz: { averageScore: null, totalAttempts: 0 },
    comprehension: { lowCount: 0, assessedCount: 0 },
    pronunciation: { avgScore: null, attempts: 0 },
    level: null,
    readingRec: null,
  });
  assert.ok(starterItems.some((item) => item.id === "starter:review"));

  skillProfile = {
    totalEvidence: 1,
    skills: [
      { skill: "vocabulary", confidence: 0.9, evidenceCount: 1, hasEvidence: true },
      { skill: "grammar", confidence: 0.9, evidenceCount: 1, hasEvidence: true },
    ] as SkillSummary[],
  };
  coachConfidences = new Map([["grammar", 0.2]]);
  weakWordCount = 1;
  totalSaved = 4;
  const diag = await gatherStudyDiagnostics("u1", async () => ({
    id: "rec-1",
    title: "Reading Rec",
    reason: "right level",
  }));
  assert.equal(diag.skills.find((skill) => skill.skill === "grammar")?.confidence, 0.2);
  assert.equal(diag.readingRec?.id, "rec-1");

  coachConfidences = new Map();
  skillProfile = { skills: [], totalEvidence: 0 };
  weakWordCount = 1;
  dueCount = 0;
  totalSaved = 4;
  pickRows = [{ id: "pick-1", title: "Pick One" }];
  const plan = await generateStudyPlan("u1");
  assert.match(plan.summary, /focus on vocabulary\./);
  assert.ok(plan.items.some((item) => item.kind === "reading-rec"));
});

test("i18n falls back to the key when a missing or throwing message is requested", async () => {
  const { t } = await import("@/lib/i18n");
  assert.equal(t("push.reminder.title" as never), "Time to review! 📚");
  assert.equal(
    t("reader.translate.unavailable" as never, { lang: "Spanish" } as never),
    "Translation into Spanish is unavailable right now because the AI translation service is not configured. Please try again later.",
  );
  assert.equal(t("missing.key" as never), "missing.key");
  assert.equal(t("reader.translate.unavailable" as never), "reader.translate.unavailable");
});
