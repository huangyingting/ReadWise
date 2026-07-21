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
const requestId = "req-1";
const log = {
  error: (_event: string, meta?: Record<string, unknown>) => {
    clientLogMeta = meta ?? null;
  },
  info: () => {},
  warn: () => {},
};

function requestCtx(overrides: Record<string, unknown> = {}) {
  return { req, session, requestId, ...overrides } as never;
}

function sessionCtx(overrides: Record<string, unknown> = {}) {
  return { session, ...overrides } as never;
}

async function assertApiError(action: () => Promise<unknown>, status: number): Promise<void> {
  await assert.rejects(action, { name: "ApiError", status });
}

async function assertJson(res: Response, expected: unknown): Promise<void> {
  assert.deepEqual(await res.json(), expected);
}

let progressResult: { percent: number; completed: boolean };
let recordedEvents: unknown[];
let revalidatedUsers: string[];
let todaySyncCalls: unknown[];
let masteryCalls: string[];
let learnerEvidenceCalls: unknown[];
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
let incrementalRunRequests: Array<{ providerKeys: string[] }>;
let incrementalRequested: number;
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
  mock.module("@/lib/learning/learner-evidence", {
    namedExports: {
      recordLearnerEvidence: async (_userId: string, evidence: unknown) => {
        learnerEvidenceCalls.push(evidence);
      },
    },
  });
  mock.module("@/lib/learning/primitives", {
    namedExports: {
      clamp01: (value: number) => Math.min(1, Math.max(0, value)),
      parseStringArray: (value: unknown) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []),
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
      ARTICLES_CACHE_TAG: "articles",
      TAGS_CACHE_TAG: "tags",
      ORG_CACHE_TAG: "org",
      LISTING_REVALIDATE_SECONDS: 300,
      MAX_TENANT_CACHE_SIZE: 500,
      orgCacheTag: (orgId: string) => `org:${orgId}`,
      userCacheTag: (userId: string) => `user:${userId}`,
      createCachedListing: <Args extends unknown[], T>(fn: (...args: Args) => Promise<T>) => fn,
      createTenantCachedListing: <Args extends unknown[], T>(fn: (...args: Args) => Promise<T>) => fn,
      tenantCacheKeyParts: () => [],
      revalidateArticlesCache: () => {
        revalidateArticlesCalls++;
      },
      revalidateOrgCache: () => {},
      revalidateTagsCache: () => {},
      revalidateUserCache: (userId: string) => {
        revalidatedUsers.push(userId);
      },
    },
  });
  mock.module("@/lib/engagement/today-session/integrations", {
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
      publicListableArticleWhere: (extra?: unknown) => ({ visibility: "PUBLIC", ...((extra as object) ?? {}) }),
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
      SEARCH_CANDIDATE_LIMIT: 500,
      ARTICLE_SEARCH_FIELDS: ["title", "excerpt", "content", "author", "source", "category"],
      TITLE_ARTICLE_SEARCH_FIELDS: ["title"],
      BYLINE_ARTICLE_SEARCH_FIELDS: ["author", "source"],
      HIGHLIGHT_SEARCH_FIELDS: ["quote", "note"],
      SAVED_WORD_SEARCH_FIELDS: ["word", "explanation", "example", "contextSentence"],
      buildSearchTerms: (raw: string) => raw.trim().split(/\s+/).filter(Boolean),
      containsFilter: (value: string) => ({ contains: value, mode: "insensitive" }),
      candidateTake: (offset: number, limit: number) => offset + limit * 10,
      priorityTake: (offset: number, limit: number) => offset + limit,
      articleFieldsWhere: () => ({}),
      articleTextWhere: () => ({}),
      articleExactWhere: () => ({}),
      highlightTextWhere: () => ({}),
      savedWordTextWhere: () => ({}),
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
      sessionUserRateLimitPolicy: (_scope: string) => ({}),
      clientIpRateLimitPolicy: (
        _scope: string,
        options?: { onExceeded?: (ctx: unknown, error: MockApiError) => unknown },
      ) => ({ onExceeded: options?.onExceeded }),
      enforceRateLimitPolicy: async (policy: {
        onExceeded?: (ctx: unknown, error: MockApiError) => unknown;
      }) => {
        if (!rateLimitThrows) return undefined;
        if (policy.onExceeded) {
          return policy.onExceeded({ req }, new MockApiError(429, "limited"));
        }
        throw new MockApiError(429, "limited");
      },
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
  mock.module("@/lib/engagement/today-session/actions", {
    namedExports: {
      enforceTodayGate: () => {
        if (!todayFeatureEnabled) throw new MockApiError(404, "Not found");
      },
      COMPREHENSION_SELF_RATINGS: ["easy", "ok", "hard"],
      COMPREHENSION_SKILL_TAGS: ["main_idea", "detail"],
      submitTodayComprehension: async () => todaySubmitResult,
      setTodayPrimaryArticle: async () => {
        if (setTodayError) throw setTodayError;
      },
      SetTodayArticleError: MockSetTodayArticleError,
      skipTodaySession: async () => ({ skipped: true }),
      TODAY_DAILY_SKIP_LIMIT: 2,
      TODAY_SKIP_REASONS: ["too_hard", "already_read", "not_interesting"],
      markTodayReadingCompleteManual: async () => {},
      markTodayWordReviewComplete: async () => {},
    },
  });
  mock.module("@/lib/runtime-config/feature-flags", {
    namedExports: {
      isTodaySessionFeatureEnabled: () => todayFeatureEnabled,
      isFeatureEnabled: (feature: string) =>
        feature === "todaySession" ? todayFeatureEnabled : true,
      defineFeatureGate: <C, D>(gate: { feature: string; whenDisabled: (ctx: C) => D }) => gate,
      enforceFeatureGate: <C, D>(
        gate: { feature: string; whenDisabled: (ctx: C) => D },
        ctx: C,
      ): D | undefined => {
        const enabled = gate.feature === "todaySession" ? todayFeatureEnabled : true;
        if (!enabled) return gate.whenDisabled(ctx);
        return undefined;
      },
    },
  });
  mock.module("@/lib/engagement/today-session", {
    namedExports: {
      SetTodayArticleError: MockSetTodayArticleError,
      loadTodayViewModel: async () => todayView,
      loadTodayComprehensionCheck: async () => todayCheck,
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
      getProviderByName: (name: string) =>
        adminProviders.find((provider) => provider.name?.toLowerCase() === name.trim().toLowerCase()) ?? null,
      isProviderCategoryReadingSuitable: (_provider: unknown, _category: string | null) => true,
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
      scrapeAndSave: async (
        url: string,
        auditFactory: (created: { id: string }) => unknown,
      ) => {
        const scraped = scrapeResults.shift() ?? null;
        if (!scraped) {
          return {
            status: "failed",
            failure: "extract",
            reason: "could not extract article content",
            sourceUrl: url,
          };
        }
        const outcome = saveOutcomes.shift() ?? { status: "saved" };
        if (outcome.status === "throw") {
          return {
            status: "failed",
            failure: "save",
            reason: "save crashed",
            sourceUrl: url,
          };
        }
        if (outcome.status === "failed") {
          return {
            ...outcome,
            failure: "save",
            sourceUrl: url,
          };
        }
        if (outcome.status === "saved") {
          auditCalls.push(auditFactory({ id: "article-new" }));
        }
        return outcome;
      },
    },
  });
  mock.module("@/lib/scraper/incremental/incremental-run-request", {
    namedExports: {
      requestIncrementalRun: async (providerKeys: string[]) => {
        incrementalRunRequests.push({ providerKeys: [...providerKeys] });
        return { requested: incrementalRequested };
      },
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
  learnerEvidenceCalls = [];
  quizResult = { articleId: "a1", questions: [] };
  tagsResult = { articleId: "a1", tags: [] };
  speechResult = { articleId: "a1", fallback: true };
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
  incrementalRunRequests = [];
  incrementalRequested = 2;
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
  await assertJson(res, { percent: 60, completed: false });
  assert.deepEqual(recordedEvents, []);
  assert.deepEqual(revalidatedUsers, []);
  assert.equal(todaySyncCalls.length, 1);
  assert.deepEqual(masteryCalls, [
    "progress.article_mastery",
    "progress.today_reading",
  ]);
  assert.deepEqual(learnerEvidenceCalls, [
    { activity: "reading-progress", percent: 60 },
  ]);

  progressResult = { percent: 100, completed: true };
  res = await POST({ params: { id: "a1" }, body: { percent: 100 }, session } as never);
  await assertJson(res, { percent: 100, completed: true });
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
  await assertApiError(() => quizRoute.POST(sessionCtx({ params: { id: "a1" } })), 404);
  tagsResult = null;
  await assertApiError(() => tagsRoute.POST(sessionCtx({ params: { id: "a1" } })), 404);
  speechResult = null;
  await assertApiError(() => speechRoute.POST(sessionCtx({ params: { id: "a1" } })), 404);
});

test("reader offline route returns metadata-only and full offline payloads", async () => {
  const { GET } = await import("@/app/api/reader/[id]/offline/route");

  let res = await GET({ params: { id: "a1" }, query: { meta: true }, session } as never);
  await assertJson(res, {
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
  let res = await POST(requestCtx({ body: { url: "https://example.test/a1" } }));
  assert.equal(res.status, 200);
  await assertJson(res, { id: "url-import", duplicate: true });

  importUrlResult = { id: "url-import-2", status: 201 };
  res = await POST(requestCtx({ body: { url: "https://example.test/a2" } }));
  assert.equal(res.status, 201);

  res = await POST(requestCtx({ body: { title: "   ", text: "Pasted text" } }));
  assert.equal(res.status, 201);
  assert.equal((importTextArgs[0] as { title: string }).title, "Untitled import");

  await assertApiError(() => POST(requestCtx({ body: {} })), 400);

  res = await GET(sessionCtx({ query: { offset: 10, limit: 5 } }));
  await assertJson(res, {
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

test("admin scrape trigger validates input and requests incremental runs (never synchronous scrape)", async () => {
  const { POST } = await import("@/app/api/admin/scrape/trigger/route");

  await assertApiError(() => POST(requestCtx({ body: { provider: "missing" }, log })), 400);
  await assertApiError(() => POST(requestCtx({ body: {}, log })), 400);

  // Unsupported modes fail EXPLICITLY (Phase 3) instead of falling through.
  await assertApiError(() => POST(requestCtx({ body: { provider: "provider-a", mode: "backfill" }, log })), 400);
  await assertApiError(() => POST(requestCtx({ body: { provider: "provider-a", mode: "force-rescrape" }, log })), 400);
  assert.equal(incrementalRunRequests.length, 0, "no run is requested for a rejected input/mode");

  // Happy path: a single provider requests an incremental discovery run.
  incrementalRequested = 2;
  let res = await POST(requestCtx({ body: { provider: "provider-a" }, log }));
  let body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.mode, "incremental");
  assert.equal(body.results[0].provider, "provider-a");
  assert.equal(body.results[0].sourcesRequested, 2);
  assert.equal(body.totalSourcesRequested, 2);
  assert.equal(incrementalRunRequests.length, 1);
  assert.deepEqual(incrementalRunRequests[0].providerKeys, ["provider-a"]);

  // all:true requests a run for every registered provider.
  incrementalRunRequests = [];
  res = await POST(requestCtx({ body: { all: true, limit: 3 }, log }));
  body = await res.json();
  assert.equal(body.results.length, adminProviders.length);
  assert.equal(incrementalRunRequests.length, adminProviders.length);
});

test("profile, search, Today, push subscribe, and speech token routes cover validation and fallbacks", async () => {
  const profileRoute = await import("@/app/api/profile/route");
  const searchRoute = await import("@/app/api/search/route");
  const todayComprehensionRoute = await import("@/app/api/today/comprehension/route");
  const todaySetArticleRoute = await import("@/app/api/today/set-article/route");
  const pushSubscribeRoute = await import("@/app/api/push/subscribe/route");
  const speechTokenRoute = await import("@/app/api/speech/token/route");
  const pushSubscribe = (endpoint: string) =>
    pushSubscribeRoute.POST(sessionCtx({ body: { endpoint, p256dh: "p", auth: "a" }, log }));

  assert.deepEqual((profileRoute.PUT as any).__config.body(null), {
    ok: false,
    error: "Request body must be an object",
  });
  assert.deepEqual((profileRoute.PUT as any).__config.body({ level: "B1" }), {
    ok: true,
    value: { level: "B1" },
  });
  let res = await profileRoute.PUT({ body: { level: "B1" }, session } as never);
  await assertJson(res, { ok: true });
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
  await assertJson(res, {
    articles: [{ id: "search-a1", title: "Mapped" }],
    opts: { offset: 2, hasMore: true },
    progress: {},
  });

  todayFeatureEnabled = false;
  await assertApiError(() => todayComprehensionRoute.GET(sessionCtx({ query: { timezone: null } })), 404);
  await assertApiError(() => todayComprehensionRoute.POST(sessionCtx({ body: { selfRating: "ok" } })), 404);
  await assertApiError(() => todaySetArticleRoute.POST(sessionCtx({ body: { articleId: "a1" } })), 404);

  todayFeatureEnabled = true;
  assert.deepEqual(
    (todayComprehensionRoute.GET as any).__config.query(new URLSearchParams({ timezone: " UTC " })),
    { ok: true, value: { timezone: "UTC" } },
  );
  res = await todayComprehensionRoute.GET({ query: { timezone: "UTC" }, session } as never);
  await assertJson(res, { question: null, completed: false });
  todaySubmitResult = null;
  res = await todayComprehensionRoute.POST({ body: { selfRating: "hard" }, session } as never);
  await assertJson(res, { updated: false });
  todaySubmitResult = { updated: true, completed: true };
  res = await todayComprehensionRoute.POST({
    body: { selfRating: "ok", selectedIndex: 1 },
    session,
  } as never);
  await assertJson(res, { updated: true, completed: true });

  setTodayError = new MockSetTodayArticleError("missing", "not_found");
  await assertApiError(() => todaySetArticleRoute.POST(sessionCtx({ body: { articleId: "missing" } })), 404);
  setTodayError = new MockSetTodayArticleError("not ready", "not_ready");
  await assertApiError(() => todaySetArticleRoute.POST(sessionCtx({ body: { articleId: "draft" } })), 409);
  setTodayError = new Error("boom");
  await assert.rejects(
    () => todaySetArticleRoute.POST({ body: { articleId: "a1" }, session } as never),
    /boom/,
  );
  setTodayError = null;
  res = await todaySetArticleRoute.POST({ body: { articleId: "a1", timezone: "UTC" }, session } as never);
  await assertJson(res, { today: true });

  pushConfigured = false;
  await assertApiError(() => pushSubscribe("https://push.test/sub"), 503);
  pushConfigured = true;
  await assertApiError(() => pushSubscribe("not a url"), 400);
  await assertApiError(() => pushSubscribe("http://push.test/sub"), 400);
  subscribeResult = { ok: false, status: 409, error: "exists" };
  await assertApiError(() => pushSubscribe("https://push.test/sub"), 409);
  subscribeResult = { ok: true };
  res = await pushSubscribe("https://push.test/sub");
  assert.equal(res.status, 201);

  speechConfigured = false;
  res = await speechTokenRoute.GET({ session } as never);
  await assertJson(res, { configured: false });
  speechConfigured = true;
  speechRuntimeConfig = null;
  res = await speechTokenRoute.GET({ session } as never);
  await assertJson(res, { configured: false });
  speechRuntimeConfig = { key: "test-key", region: "eastus" };
  speechTokenResponse = new Error("network");
  res = await speechTokenRoute.GET({ session } as never);
  assert.equal(res.status, 502);
  speechTokenResponse = new Response("bad", { status: 500 });
  res = await speechTokenRoute.GET({ session } as never);
  assert.equal(res.status, 502);
  speechTokenResponse = new Response("token-2");
  res = await speechTokenRoute.GET({ session } as never);
  await assertJson(res, { configured: true, token: "token-2", region: "eastus" });
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
  await assertApiError(() => POST(requestCtx({ body })), 422);

  backfillError = new Error("backfill crashed");
  await assert.rejects(
    () => POST(requestCtx({ body })),
    /backfill crashed/,
  );

  backfillError = null;
  const res = await POST(requestCtx({ body }));
  await assertJson(res, backfillResult);
  assert.ok(JSON.stringify(auditCalls).includes("admin.job.backfill"));
});

test("account, onboarding, takedown, and series routes map domain results", async () => {
  const accountRoute = await import("@/app/api/account/route");
  const onboardingRoute = await import("@/app/api/onboarding/route");
  const takedownRoute = await import("@/app/api/admin/articles/[id]/takedown/route");
  const seriesRoute = await import("@/app/api/series/[id]/enroll/route");

  deleteOwnAccountResult = { ok: false, status: 409, error: "cannot delete" };
  await assertApiError(() => accountRoute.DELETE(requestCtx()), 409);
  deleteOwnAccountResult = { ok: true };
  let res = await accountRoute.DELETE(requestCtx());
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
  await assertJson(res, { ok: true });
  assert.equal(completeOnboardingCalls.length, 1);
  assert.deepEqual(recordedEvents.at(-1), {
    type: "onboarding.complete",
    userId: "user-1",
    properties: { englishLevel: "B1", topicCount: 2 },
  });

  takedownResult = { ok: false, status: 404, error: "missing" };
  await assertApiError(
    () => takedownRoute.POST(requestCtx({ params: { id: "a1" }, body: { state: "blocked" } })),
    404,
  );
  takedownResult = { ok: true, previousState: "active", state: "blocked", status: "DRAFT" };
  res = await takedownRoute.POST(
    requestCtx({
      params: { id: "a1" },
      body: { state: "blocked", note: "rights", rightsNote: "reviewed" },
    }),
  );
  await assertJson(res, { ok: true, state: "blocked", status: "DRAFT" });
  assert.equal(revalidateArticlesCalls, 1);

  enrollResult = { ok: false };
  await assertApiError(() => seriesRoute.POST(sessionCtx({ params: { id: "series-1" } })), 404);
  enrollResult = { ok: true, status: "enrolled" };
  res = await seriesRoute.POST({ params: { id: "series-1" }, session } as never);
  await assertJson(res, { ok: true, status: "enrolled" });

  unenrollResult = { ok: false };
  await assertApiError(() => seriesRoute.DELETE(sessionCtx({ params: { id: "series-1" } })), 404);
  unenrollResult = { ok: true };
  res = await seriesRoute.DELETE({ params: { id: "series-1" }, session } as never);
  await assertJson(res, { ok: true });
});
