process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

class MockApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type Handler = (ctx: Record<string, any>) => Promise<Response> | Response;

const passthroughHandler = (config: unknown, handler: Handler) =>
  Object.assign(handler, { __config: config });
const passthroughCapabilityHandler = (_capability: unknown, config: unknown, handler: Handler) =>
  Object.assign(handler, { __config: config });
const session = { user: { id: "user-1", role: "Admin" } };
const req = new Request("http://test.local/api");
const log = {
  error: (_event: string, meta?: Record<string, unknown>) => {
    clientLogMeta = meta ?? null;
  },
  info: () => {},
  warn: () => {},
};

let progressResult: { percent: number; completed: boolean };
let recordedEvents: unknown[];
let revalidatedUsers: string[];
let todaySyncCalls: unknown[];
let masteryCalls: string[];
let quizResult: unknown;
let tagsResult: unknown;
let speechResult: unknown;
let offlineArticle: Record<string, any>;
let importUrlResult: { id: string; status: number };
let importTextArgs: unknown[];
let personalPage: { articles: unknown[]; hasMore: boolean };
let clientLogMeta: Record<string, unknown> | null;
let capturedErrors: Array<{ message: string; stack?: string; route?: string }>;
let rateLimitThrows: boolean;
const adminProviders: Array<{ key: string; name: string }> = [];
let discoveredUrls: string[];
let discoverThrows: Error | null;
let scrapeResults: Array<Record<string, unknown> | null>;
let saveOutcomes: Array<{ status: "saved" | "skipped" | "failed" | "throw"; reason?: string }>;
let auditCalls: unknown[];
let securityEvents: unknown[];
let revalidateArticlesCalls: number;
let profileUpdates: unknown[];
let searchPage: { articles: Array<{ id: string }>; hasMore: boolean };
let todayFeatureEnabled: boolean;
let todayCheck: unknown;
let todaySubmitResult: unknown;
let setTodayError: Error | null;
let todayView: unknown;
let subscribeResult: { ok: true } | { ok: false; status: number; error: string };
let pushConfigured: boolean;
let speechConfigured: boolean;
let speechRuntimeConfig: { key: string; region: string } | null;
let speechTokenResponse: Response | Error;
let backfillResult: Record<string, unknown>;
let backfillError: Error | null;
let deleteOwnAccountResult: { ok: true } | { ok: false; status: number; error: string };
let completeOnboardingCalls: unknown[];
let takedownResult:
  | (Record<string, unknown> & { ok: true; status: string })
  | (Record<string, unknown> & { ok: false; status: number; error: string });
let enrollResult: { ok: boolean; status?: string };
let unenrollResult: { ok: boolean };

class MockSetTodayArticleError extends Error {
  readonly code: "not_found" | "not_ready";

  constructor(message: string, code: "not_found" | "not_ready") {
    super(message);
    this.name = "SetTodayArticleError";
    this.code = code;
  }
}

class MockBackfillError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BackfillError";
    this.status = status;
  }
}

before(() => {
  mock.module("@/lib/api-handler", {
    namedExports: {
      ApiError: MockApiError,
      createAdminHandler: passthroughHandler,
      createCapabilityHandler: passthroughCapabilityHandler,
      createHandler: passthroughHandler,
      createPublicHandler: passthroughHandler,
    },
  });
  mock.module("@/lib/reader/route-guard", {
    namedExports: {
      requireReadableArticle: async () => ({ article: offlineArticle }),
      requireReadableArticleForAI: async () => ({ context: { userId: "user-1" } }),
    },
  });
  mock.module("@/lib/engagement/progress", {
    namedExports: {
      saveProgress: async () => progressResult,
    },
  });
  mock.module("@/lib/learning/article-mastery", {
    namedExports: {
      updateArticleMastery: async () => {},
    },
  });
  mock.module("@/lib/learning/skill-mastery", {
    namedExports: {
      recordSkillEvidence: async () => {},
    },
  });
  mock.module("@/lib/learning/primitives", {
    namedExports: {
      bestEffortMastery: async (label: string, fn: () => unknown) => {
        masteryCalls.push(label);
        return fn();
      },
    },
  });
  mock.module("@/lib/analytics/events", {
    namedExports: {
      ANALYTICS_EVENT_TYPES: {
        onboardingComplete: "onboarding.complete",
        progressComplete: "progress.complete",
      },
      recordEvent: async (input: unknown) => {
        recordedEvents.push(input);
      },
    },
  });
  mock.module("@/lib/cache", {
    namedExports: {
      revalidateArticlesCache: () => {
        revalidateArticlesCalls++;
      },
      revalidateUserCache: (userId: string) => {
        revalidatedUsers.push(userId);
      },
    },
  });
  mock.module("@/lib/engagement/today-session/completion", {
    namedExports: {
      syncTodayReadingFromProgress: async (input: unknown) => {
        todaySyncCalls.push(input);
      },
    },
  });
  mock.module("@/lib/quiz", {
    namedExports: {
      getOrCreateArticleQuiz: async () => quizResult,
    },
  });
  mock.module("@/lib/article-library", {
    namedExports: {
      applyTakedown: async () => takedownResult,
      getOrCreateArticleTags: async () => tagsResult,
      IMPORTS_MAX_LIMIT: 50,
      IMPORTS_PAGE_SIZE: 20,
      readingMinutesFor: () => 7,
    },
  });
  mock.module("@/lib/speech", {
    namedExports: {
      getOrCreateArticleSpeech: async () => speechResult,
      isSpeechConfigured: () => speechConfigured,
    },
  });
  mock.module("@/lib/runtime-config/speech", {
    namedExports: {
      speechConfig: {
        get: () => speechRuntimeConfig,
      },
    },
  });
  mock.module("@/lib/http/provider-client", {
    namedExports: {
      providerFetch: async () => {
        if (speechTokenResponse instanceof Error) throw speechTokenResponse;
        return speechTokenResponse;
      },
    },
  });
  mock.module("@/features/profile-preferences/schema", {
    namedExports: {
      parseProfileInput: (value: Record<string, unknown>) => ({ ok: true, value }),
    },
  });
  mock.module("@/lib/profile/commands", {
    namedExports: {
      completeOnboarding: async (userId: string, body: unknown) => {
        completeOnboardingCalls.push({ userId, body });
      },
      updateProfile: async (userId: string, body: unknown) => {
        profileUpdates.push({ userId, body });
      },
    },
  });
  mock.module("@/lib/search/query", {
    namedExports: {
      SEARCH_MAX_LIMIT: 50,
      SEARCH_PAGE_SIZE: 20,
    },
  });
  mock.module("@/lib/search/providers", {
    namedExports: {
      searchReadableArticles: async () => searchPage,
    },
  });
  mock.module("@/lib/content-pipeline", {
    namedExports: {
      sanitizeArticleHtml: (html: string) => `<clean>${html}</clean>`,
    },
  });
  mock.module("@/lib/cache-version", {
    namedExports: {
      contentHash: (html: string) => `hash:${html.length}`,
      makeArticleVersion: ({ contentHash }: { contentHash: string }) => `v:${contentHash}`,
    },
  });
  mock.module("@/lib/article-library/listings", {
    namedExports: {
      listPersonalArticlesPage: async () => personalPage,
    },
  });
  mock.module("@/lib/article-library/mapper", {
    namedExports: {
      toListingArticle: (article: { id: string }) => ({ id: article.id, title: "Mapped" }),
    },
  });
  mock.module("@/lib/article-library/listing-response", {
    namedExports: {
      buildArticleListResponse: async (_userId: string, articles: unknown[], opts: unknown) => ({
        articles,
        opts,
        progress: {},
      }),
    },
  });
  mock.module("@/lib/import", {
    namedExports: {
      MAX_TEXT_BYTES: 500_000,
      importArticleFromText: async (input: unknown) => {
        importTextArgs.push(input);
        return { id: "text-import" };
      },
      importArticleFromUrl: async () => importUrlResult,
    },
  });
  mock.module("@/lib/security/rate-limit/index", {
    namedExports: {
      checkRateLimit: async () => {},
      checkRateLimitByKey: async () => {
        if (rateLimitThrows) throw new Error("limited");
      },
      clientIpKey: () => "ip:test",
    },
  });
  mock.module("@/lib/engagement/today-session/comprehension", {
    namedExports: {
      COMPREHENSION_SELF_RATINGS: ["easy", "ok", "hard"],
      COMPREHENSION_SKILL_TAGS: ["main_idea", "detail"],
      loadTodayComprehensionCheck: async () => todayCheck,
      submitTodayComprehension: async () => todaySubmitResult,
    },
  });
  mock.module("@/lib/runtime-config/feature-flags", {
    namedExports: {
      isTodaySessionFeatureEnabled: () => todayFeatureEnabled,
    },
  });
  mock.module("@/lib/engagement/today-session", {
    namedExports: {
      SetTodayArticleError: MockSetTodayArticleError,
      loadTodayViewModel: async () => todayView,
      setTodayPrimaryArticle: async () => {
        if (setTodayError) throw setTodayError;
      },
    },
  });
  mock.module("@/lib/push/provider", {
    namedExports: {
      isPushConfigured: () => pushConfigured,
    },
  });
  mock.module("@/lib/push/commands", {
    namedExports: {
      subscribePush: async () => subscribeResult,
    },
  });
  mock.module("@/lib/account-lifecycle", {
    namedExports: {
      deleteOwnAccount: async () => deleteOwnAccountResult,
    },
  });
  mock.module("@/lib/rbac", {
    namedExports: {
      CAPABILITIES: { contentModerate: "content.moderate" },
    },
  });
  mock.module("@/lib/admin/articles/schemas", {
    namedExports: {
      takedownBody: (value: unknown) => ({ ok: true, value }),
    },
  });
  mock.module("@/lib/engagement/series", {
    namedExports: {
      enrollInSeries: async () => enrollResult,
      unenrollFromSeries: async () => unenrollResult,
    },
  });
  mock.module("@/lib/processing/backfill", {
    namedExports: {
      BACKFILL_FEATURES: ["tts", "tags"],
      BackfillError: MockBackfillError,
      runBackfill: async () => {
        if (backfillError) throw backfillError;
        return backfillResult;
      },
    },
  });
  mock.module("@/lib/observability/errors", {
    namedExports: {
      captureError: (err: Error, ctx: { route?: string }) => {
        capturedErrors.push({ message: err.message, stack: err.stack, route: ctx.route });
      },
    },
  });
  mock.module("@/lib/scraper/providers", {
    namedExports: {
      PROVIDERS: adminProviders,
      getProvider: (key: string) => adminProviders.find((provider) => provider.key === key) ?? null,
    },
  });
  mock.module("@/lib/scraper/discovery", {
    namedExports: {
      discoverProviderUrls: async () => {
        if (discoverThrows) throw discoverThrows;
        return discoveredUrls;
      },
    },
  });
  mock.module("@/lib/scraper", {
    namedExports: {
      saveDraftArticle: async (_article: unknown, auditFactory: (created: { id: string }) => unknown) => {
        const outcome = saveOutcomes.shift() ?? { status: "saved" };
        if (outcome.status === "throw") throw new Error("save crashed");
        auditCalls.push(auditFactory({ id: "article-new" }));
        return outcome;
      },
      scrapeUrl: async () => scrapeResults.shift() ?? null,
    },
  });
  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {
        adminArticleIngest: "admin.article.ingest",
        adminJobBackfill: "admin.job.backfill",
        adminScrapeTrigger: "admin.scrape.trigger",
      },
      recordAuditFromRequest: async (input: unknown) => {
        auditCalls.push(input);
      },
    },
  });
  mock.module("@/lib/security/events", {
    namedExports: {
      SECURITY_EVENT_TYPES: { importFailed: "import.failed" },
      recordSecurityEvent: (input: unknown) => {
        securityEvents.push(input);
      },
    },
  });
  mock.module("@/lib/security/client-ip", {
    namedExports: {
      clientIp: () => "127.0.0.1",
    },
  });
});

beforeEach(() => {
  progressResult = { percent: 60, completed: false };
  recordedEvents = [];
  revalidatedUsers = [];
  todaySyncCalls = [];
  masteryCalls = [];
  quizResult = { articleId: "a1", questions: [] };
  tagsResult = { articleId: "a1", tags: [] };
  speechResult = { articleId: "a1", audio: null };
  offlineArticle = {
    id: "a1",
    title: "Offline",
    content: "<p>Body</p>",
    author: null,
    source: "Source",
    sourceUrl: "https://example.test/a1",
    heroImage: null,
    difficulty: "B1",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    publishedAt: null,
  };
  importUrlResult = { id: "url-import", status: 201 };
  importTextArgs = [];
  personalPage = { articles: [{ id: "a1" }], hasMore: true };
  clientLogMeta = null;
  capturedErrors = [];
  rateLimitThrows = false;
  adminProviders.length = 0;
  adminProviders.push({ key: "provider-a", name: "Provider A" });
  discoveredUrls = ["https://example.test/one", "https://example.test/two"];
  discoverThrows = null;
  scrapeResults = [{ title: "One" }, null];
  saveOutcomes = [{ status: "saved" }];
  auditCalls = [];
  securityEvents = [];
  revalidateArticlesCalls = 0;
  profileUpdates = [];
  searchPage = { articles: [{ id: "search-a1" }], hasMore: true };
  todayFeatureEnabled = true;
  todayCheck = { question: null, completed: false };
  todaySubmitResult = { updated: true, completed: true };
  setTodayError = null;
  todayView = { today: true };
  subscribeResult = { ok: true };
  pushConfigured = true;
  speechConfigured = true;
  speechRuntimeConfig = { key: "test-key", region: "eastus" };
  speechTokenResponse = new Response("token-1");
  backfillError = null;
  backfillResult = {
    mode: "missing",
    features: ["tts"],
    reason: "maintenance",
    dryRun: true,
    scanned: 1,
    matched: 1,
    cap: 10,
    enqueued: 0,
    skippedExisting: 1,
    cleared: 0,
  };
  deleteOwnAccountResult = { ok: true };
  completeOnboardingCalls = [];
  takedownResult = { ok: true, previousState: "active", state: "blocked", status: "DRAFT" };
  enrollResult = { ok: true, status: "enrolled" };
  unenrollResult = { ok: true };
});

test("reader progress route records completion side effects only when completed", async () => {
  const { POST } = await import("@/app/api/reader/[id]/progress/route");

  let res = await POST({ params: { id: "a1" }, body: { percent: 60 }, session } as never);
  assert.deepEqual(await res.json(), { percent: 60, completed: false });
  assert.deepEqual(recordedEvents, []);
  assert.deepEqual(revalidatedUsers, []);
  assert.equal(todaySyncCalls.length, 1);
  assert.deepEqual(masteryCalls, [
    "progress.article_mastery",
    "progress.reading_skill",
    "progress.today_reading",
  ]);

  progressResult = { percent: 100, completed: true };
  res = await POST({ params: { id: "a1" }, body: { percent: 100 }, session } as never);
  assert.deepEqual(await res.json(), { percent: 100, completed: true });
  assert.deepEqual(recordedEvents[0], {
    type: "progress.complete",
    userId: "user-1",
    articleId: "a1",
    properties: { percent: 100, category: undefined },
  });
  assert.deepEqual(revalidatedUsers, ["user-1"]);
});

test("reader AI routes return payloads and throw 404 ApiError for null results", async () => {
  const quizRoute = await import("@/app/api/reader/[id]/quiz/route");
  const tagsRoute = await import("@/app/api/reader/[id]/tags/route");
  const speechRoute = await import("@/app/api/reader/[id]/speech/route");

  assert.equal((await quizRoute.POST({ params: { id: "a1" }, session } as never)).status, 200);
  assert.equal((await tagsRoute.POST({ params: { id: "a1" }, session } as never)).status, 200);
  assert.equal((await speechRoute.POST({ params: { id: "a1" }, session } as never)).status, 200);

  quizResult = null;
  await assert.rejects(() => quizRoute.POST({ params: { id: "a1" }, session } as never), {
    name: "ApiError",
    status: 404,
  });
  tagsResult = null;
  await assert.rejects(() => tagsRoute.POST({ params: { id: "a1" }, session } as never), {
    name: "ApiError",
    status: 404,
  });
  speechResult = null;
  await assert.rejects(() => speechRoute.POST({ params: { id: "a1" }, session } as never), {
    name: "ApiError",
    status: 404,
  });
});

test("reader offline route returns metadata-only and full offline payloads", async () => {
  const { GET } = await import("@/app/api/reader/[id]/offline/route");

  let res = await GET({ params: { id: "a1" }, query: { meta: true }, session } as never);
  assert.deepEqual(await res.json(), {
    id: "a1",
    version: "v:hash:26",
    contentHash: "hash:26",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  offlineArticle.publishedAt = new Date("2025-12-31T00:00:00.000Z");
  res = await GET({ params: { id: "a1" }, query: { meta: false }, session } as never);
  const body = await res.json();
  assert.equal(body.sanitizedHtml, "<clean><p>Body</p></clean>");
  assert.equal(body.readingMinutes, 7);
  assert.equal(body.publishedAt, "2025-12-31T00:00:00.000Z");
});

test("article import route handles URL duplicates, text defaults, validation, and listing response", async () => {
  const { GET, POST } = await import("@/app/api/articles/import/route");

  importUrlResult = { id: "url-import", status: 200 };
  let res = await POST({ req, body: { url: "https://example.test/a1" }, session, requestId: "req-1" } as never);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: "url-import", duplicate: true });

  importUrlResult = { id: "url-import-2", status: 201 };
  res = await POST({ req, body: { url: "https://example.test/a2" }, session, requestId: "req-1" } as never);
  assert.equal(res.status, 201);

  res = await POST({ req, body: { title: "   ", text: "Pasted text" }, session, requestId: "req-1" } as never);
  assert.equal(res.status, 201);
  assert.equal((importTextArgs[0] as { title: string }).title, "Untitled import");

  await assert.rejects(
    () => POST({ req, body: {}, session, requestId: "req-1" } as never),
    { name: "ApiError", status: 400 },
  );

  res = await GET({ query: { offset: 10, limit: 5 }, session } as never);
  assert.deepEqual(await res.json(), {
    articles: [{ id: "a1", title: "Mapped" }],
    opts: { offset: 10, hasMore: true },
    progress: {},
  });
});

test("client error route scrubs text, strips URLs, captures errors, and absorbs rate limits", async () => {
  const { POST } = await import("@/app/api/client-errors/route");
  const token = "abcdefghijklmnopqrstuvwxyz123456";

  let res = await POST({
    body: {
      message: `Failure for person@example.test with ${token}`,
      source: undefined,
      stack: `stack ${token}`,
      url: "https://example.test/path?token=abc#frag",
    },
    log,
    req,
  } as never);
  assert.equal(res.status, 204);
  assert.equal(clientLogMeta?.clientMessage, "Failure for [email] with [token]");
  assert.equal(clientLogMeta?.clientStack, "stack [token]");
  assert.equal(clientLogMeta?.clientUrl, "https://example.test/path");
  assert.equal(capturedErrors[0].message, "Failure for [email] with [token]");
  assert.equal(capturedErrors[0].route, "https://example.test/path");

  res = await POST({
    body: { message: "Broken", source: "window", url: "/local/path?secret=1#hash" },
    log,
    req,
  } as never);
  assert.equal(res.status, 204);
  assert.equal(clientLogMeta?.clientUrl, "/local/path");

  rateLimitThrows = true;
  capturedErrors = [];
  res = await POST({ body: { message: "Limited" }, log, req } as never);
  assert.equal(res.status, 204);
  assert.deepEqual(capturedErrors, []);
});

test("admin scrape trigger records per-provider discovery and save failures", async () => {
  const { POST } = await import("@/app/api/admin/scrape/trigger/route");

  await assert.rejects(
    () => POST({ req, body: { provider: "missing" }, session, requestId: "req-1", log } as never),
    { name: "ApiError", status: 400 },
  );
  await assert.rejects(
    () => POST({ req, body: {}, session, requestId: "req-1", log } as never),
    { name: "ApiError", status: 400 },
  );

  discoverThrows = new Error("discovery failed");
  let res = await POST({ req, body: { provider: "provider-a" }, session, requestId: "req-1", log } as never);
  let body = await res.json();
  assert.equal(body.results[0].error, "discovery failed");
  assert.equal(securityEvents.length, 1);
  assert.equal(body.totalSaved, 0);

  discoverThrows = null;
  scrapeResults = [{ title: "One" }, { title: "Two" }, null];
  saveOutcomes = [{ status: "saved" }, { status: "skipped" }];
  discoveredUrls = ["one", "two", "three"];
  res = await POST({ req, body: { all: true, limit: 3 }, session, requestId: "req-1", log } as never);
  body = await res.json();
  assert.equal(body.results[0].discovered, 3);
  assert.equal(body.results[0].saved, 1);
  assert.equal(body.results[0].skipped, 1);
  assert.equal(body.results[0].failed, 1);
  assert.equal(body.totalSaved, 1);
  assert.equal(revalidateArticlesCalls, 1);

  scrapeResults = [{ title: "Broken" }];
  saveOutcomes = [{ status: "throw" }];
  discoveredUrls = ["broken"];
  res = await POST({ req, body: { provider: "provider-a" }, session, requestId: "req-1", log } as never);
  body = await res.json();
  assert.equal(body.results[0].failed, 1);
  assert.ok(securityEvents.length >= 2);
});

test("profile, search, Today, push subscribe, and speech token routes cover validation and fallbacks", async () => {
  const profileRoute = await import("@/app/api/profile/route");
  const searchRoute = await import("@/app/api/search/route");
  const todayComprehensionRoute = await import("@/app/api/today/comprehension/route");
  const todaySetArticleRoute = await import("@/app/api/today/set-article/route");
  const pushSubscribeRoute = await import("@/app/api/push/subscribe/route");
  const speechTokenRoute = await import("@/app/api/speech/token/route");

  assert.deepEqual((profileRoute.PUT as any).__config.body(null), {
    ok: false,
    error: "Request body must be an object",
  });
  assert.deepEqual((profileRoute.PUT as any).__config.body({ level: "B1" }), {
    ok: true,
    value: { level: "B1" },
  });
  let res = await profileRoute.PUT({ body: { level: "B1" }, session } as never);
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(profileUpdates, [{ userId: "user-1", body: { level: "B1" } }]);
  assert.deepEqual(revalidatedUsers, ["user-1"]);

  assert.deepEqual((searchRoute.GET as any).__config.query(new URLSearchParams({ q: "x".repeat(201) })), {
    ok: false,
    error: "q must be at most 200 characters",
  });
  assert.deepEqual(
    (searchRoute.GET as any).__config.query(new URLSearchParams({ q: "term", offset: "2", limit: "5" })),
    { ok: true, value: { q: "term", offset: 2, limit: 5 } },
  );
  res = await searchRoute.GET({ query: { q: "term", offset: 2, limit: 5 }, session } as never);
  assert.deepEqual(await res.json(), {
    articles: [{ id: "search-a1", title: "Mapped" }],
    opts: { offset: 2, hasMore: true },
    progress: {},
  });

  todayFeatureEnabled = false;
  await assert.rejects(
    () => todayComprehensionRoute.GET({ query: { timezone: null }, session } as never),
    { name: "ApiError", status: 404 },
  );
  await assert.rejects(
    () => todayComprehensionRoute.POST({ body: { selfRating: "ok" }, session } as never),
    { name: "ApiError", status: 404 },
  );
  await assert.rejects(
    () => todaySetArticleRoute.POST({ body: { articleId: "a1" }, session } as never),
    { name: "ApiError", status: 404 },
  );

  todayFeatureEnabled = true;
  assert.deepEqual(
    (todayComprehensionRoute.GET as any).__config.query(new URLSearchParams({ timezone: " UTC " })),
    { ok: true, value: { timezone: "UTC" } },
  );
  res = await todayComprehensionRoute.GET({ query: { timezone: "UTC" }, session } as never);
  assert.deepEqual(await res.json(), { question: null, completed: false });
  todaySubmitResult = null;
  res = await todayComprehensionRoute.POST({ body: { selfRating: "hard" }, session } as never);
  assert.deepEqual(await res.json(), { updated: false });
  todaySubmitResult = { updated: true, completed: true };
  res = await todayComprehensionRoute.POST({
    body: { selfRating: "ok", selectedIndex: 1 },
    session,
  } as never);
  assert.deepEqual(await res.json(), { updated: true, completed: true });

  setTodayError = new MockSetTodayArticleError("missing", "not_found");
  await assert.rejects(
    () => todaySetArticleRoute.POST({ body: { articleId: "missing" }, session } as never),
    { name: "ApiError", status: 404 },
  );
  setTodayError = new MockSetTodayArticleError("not ready", "not_ready");
  await assert.rejects(
    () => todaySetArticleRoute.POST({ body: { articleId: "draft" }, session } as never),
    { name: "ApiError", status: 409 },
  );
  setTodayError = new Error("boom");
  await assert.rejects(
    () => todaySetArticleRoute.POST({ body: { articleId: "a1" }, session } as never),
    /boom/,
  );
  setTodayError = null;
  res = await todaySetArticleRoute.POST({ body: { articleId: "a1", timezone: "UTC" }, session } as never);
  assert.deepEqual(await res.json(), { today: true });

  pushConfigured = false;
  await assert.rejects(
    () =>
      pushSubscribeRoute.POST({
        body: { endpoint: "https://push.test/sub", p256dh: "p", auth: "a" },
        session,
        log,
      } as never),
    { name: "ApiError", status: 503 },
  );
  pushConfigured = true;
  await assert.rejects(
    () =>
      pushSubscribeRoute.POST({
        body: { endpoint: "not a url", p256dh: "p", auth: "a" },
        session,
        log,
      } as never),
    { name: "ApiError", status: 400 },
  );
  await assert.rejects(
    () =>
      pushSubscribeRoute.POST({
        body: { endpoint: "http://push.test/sub", p256dh: "p", auth: "a" },
        session,
        log,
      } as never),
    { name: "ApiError", status: 400 },
  );
  subscribeResult = { ok: false, status: 409, error: "exists" };
  await assert.rejects(
    () =>
      pushSubscribeRoute.POST({
        body: { endpoint: "https://push.test/sub", p256dh: "p", auth: "a" },
        session,
        log,
      } as never),
    { name: "ApiError", status: 409 },
  );
  subscribeResult = { ok: true };
  res = await pushSubscribeRoute.POST({
    body: { endpoint: "https://push.test/sub", p256dh: "p", auth: "a" },
    session,
    log,
  } as never);
  assert.equal(res.status, 201);

  speechConfigured = false;
  res = await speechTokenRoute.GET({ session } as never);
  assert.deepEqual(await res.json(), { configured: false });
  speechConfigured = true;
  speechRuntimeConfig = null;
  res = await speechTokenRoute.GET({ session } as never);
  assert.deepEqual(await res.json(), { configured: false });
  speechRuntimeConfig = { key: "test-key", region: "eastus" };
  speechTokenResponse = new Error("network");
  res = await speechTokenRoute.GET({ session } as never);
  assert.equal(res.status, 502);
  speechTokenResponse = new Response("bad", { status: 500 });
  res = await speechTokenRoute.GET({ session } as never);
  assert.equal(res.status, 502);
  speechTokenResponse = new Response("token-2");
  res = await speechTokenRoute.GET({ session } as never);
  assert.deepEqual(await res.json(), { configured: true, token: "token-2", region: "eastus" });
});

test("admin backfill route maps domain errors, rethrows crashes, and records audit metadata", async () => {
  const { POST } = await import("@/app/api/admin/jobs/backfill/route");
  const body = {
    features: ["tts"],
    mode: "missing",
    reason: "maintenance",
    dryRun: true,
  };

  backfillError = new MockBackfillError(422, "bad backfill");
  await assert.rejects(
    () => POST({ req, body, session, requestId: "req-1" } as never),
    { name: "ApiError", status: 422 },
  );

  backfillError = new Error("backfill crashed");
  await assert.rejects(
    () => POST({ req, body, session, requestId: "req-1" } as never),
    /backfill crashed/,
  );

  backfillError = null;
  const res = await POST({ req, body, session, requestId: "req-1" } as never);
  assert.deepEqual(await res.json(), backfillResult);
  assert.ok(JSON.stringify(auditCalls).includes("admin.job.backfill"));
});

test("account, onboarding, takedown, and series routes map domain results", async () => {
  const accountRoute = await import("@/app/api/account/route");
  const onboardingRoute = await import("@/app/api/onboarding/route");
  const takedownRoute = await import("@/app/api/admin/articles/[id]/takedown/route");
  const seriesRoute = await import("@/app/api/series/[id]/enroll/route");

  deleteOwnAccountResult = { ok: false, status: 409, error: "cannot delete" };
  await assert.rejects(
    () => accountRoute.DELETE({ req, session, requestId: "req-1" } as never),
    { name: "ApiError", status: 409 },
  );
  deleteOwnAccountResult = { ok: true };
  let res = await accountRoute.DELETE({ req, session, requestId: "req-1" } as never);
  assert.equal(res.status, 204);

  assert.deepEqual((onboardingRoute.POST as any).__config.body(null), {
    ok: false,
    error: "Request body must be an object",
  });
  assert.deepEqual((onboardingRoute.POST as any).__config.body({ englishLevel: "B1" }), {
    ok: true,
    value: { englishLevel: "B1" },
  });
  res = await onboardingRoute.POST({
    body: { englishLevel: "B1", topics: ["news", "science"] },
    session,
  } as never);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(completeOnboardingCalls.length, 1);
  assert.deepEqual(recordedEvents.at(-1), {
    type: "onboarding.complete",
    userId: "user-1",
    properties: { englishLevel: "B1", topicCount: 2 },
  });

  takedownResult = { ok: false, status: 404, error: "missing" };
  await assert.rejects(
    () =>
      takedownRoute.POST({
        req,
        params: { id: "a1" },
        body: { state: "blocked" },
        session,
        requestId: "req-1",
      } as never),
    { name: "ApiError", status: 404 },
  );
  takedownResult = { ok: true, previousState: "active", state: "blocked", status: "DRAFT" };
  res = await takedownRoute.POST({
    req,
    params: { id: "a1" },
    body: { state: "blocked", note: "rights", rightsNote: "reviewed" },
    session,
    requestId: "req-1",
  } as never);
  assert.deepEqual(await res.json(), { ok: true, state: "blocked", status: "DRAFT" });
  assert.equal(revalidateArticlesCalls, 1);

  enrollResult = { ok: false };
  await assert.rejects(
    () => seriesRoute.POST({ params: { id: "series-1" }, session } as never),
    { name: "ApiError", status: 404 },
  );
  enrollResult = { ok: true, status: "enrolled" };
  res = await seriesRoute.POST({ params: { id: "series-1" }, session } as never);
  assert.deepEqual(await res.json(), { ok: true, status: "enrolled" });

  unenrollResult = { ok: false };
  await assert.rejects(
    () => seriesRoute.DELETE({ params: { id: "series-1" }, session } as never),
    { name: "ApiError", status: 404 },
  );
  unenrollResult = { ok: true };
  res = await seriesRoute.DELETE({ params: { id: "series-1" }, session } as never);
  assert.deepEqual(await res.json(), { ok: true });
});
