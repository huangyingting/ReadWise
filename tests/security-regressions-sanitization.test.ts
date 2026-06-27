/**
 * Security regression tests — HTML sanitization and SSRF protection.
 *
 * Verifies that:
 * - The offline article payload strips XSS vectors from stored HTML.
 * - The URL import route blocks SSRF via assertSafeUrl before scraping.
 * - The text import route stores sanitized private content owned by the caller.
 *
 * Mocks: @/lib/api-auth, @/lib/article-library, @/lib/prisma, @/lib/scraper/ssrf,
 *        @/lib/scraper, @/lib/security/rate-limit/index, @/lib/difficulty,
 *        @/lib/cache, @/lib/security/audit.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock, describe } from "node:test";
import assert from "node:assert/strict";
import { buildArticle } from "./helpers";
import { ArticleSourceType, ArticleStatus, ArticleVisibility } from "@prisma/client";
import { type RouteHandler } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

type MockUser = { id?: string | null; role?: string | null } | null | undefined;
type MockAccessContext = { userId?: string | null; role?: string | null };

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let authState: AuthState = "ok";
let viewableArticle: unknown = null;
let viewableCalls: Array<{ id: string; role?: string | null; userId?: string | null }> = [];
let importCreateData: Record<string, unknown> | null = null;
let importCount = 0;
let importExisting: { id: string } | null = null;
let assertSafeCalls: string[] = [];
let assertSafeThrows = false;
let scrapeCalls: string[] = [];
let auditCalls = 0;

const scrapedArticle = {
  title: "Scraped article",
  author: null,
  source: "example.com",
  sourceUrl: "https://example.com/article",
  heroImage: null,
  excerpt: null,
  content: "<p>" + "word ".repeat(60) + "</p>",
  category: null,
  wordCount: 60,
  readingMinutes: 1,
  publishedAt: null,
};

// ---------------------------------------------------------------------------
// Module mocks — registered once before any module-under-test is imported
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  mock.module("@/lib/article-library", {
    namedExports: {
      articleAccessContext: (user: MockUser): MockAccessContext => ({
        userId: user?.id ?? null,
        role: user?.role ?? null,
      }),
      getReadableArticleById: async (id: string, context?: MockAccessContext | null) => {
        viewableCalls.push({ id, role: context?.role, userId: context?.userId });
        return viewableArticle;
      },
      findOwnedArticleBySourceUrl: async () => importExisting,
      ownedArticleWhere: (userId: string, extra?: Record<string, unknown>) => ({
        ...(extra ?? {}),
        visibility: ArticleVisibility.PRIVATE,
        ownerId: userId,
      }),
      privateImportedArticleCreateFields: (ownerId: string) => ({
        visibility: ArticleVisibility.PRIVATE,
        sourceType: ArticleSourceType.IMPORTED,
        ownerId,
      }),
      getViewableArticleById: async (id: string, role?: string | null, userId?: string | null) => {
        viewableCalls.push({ id, role, userId });
        return viewableArticle;
      },
      readingMinutesFor: () => 3,
      countWords: (text: string) => text.split(/\s+/).filter(Boolean).length,
      listPersonalArticlesPage: async () => ({ articles: [], hasMore: false }),
      toListingArticle: (article: unknown) => article,
      IMPORTS_PAGE_SIZE: 20,
      IMPORTS_MAX_LIMIT: 50,
      getOrCreateArticleTags: async () => ({
        articleId: "private-article",
        tags: [],
        fallback: false,
      }),
      // policy helpers consumed by real sub-modules (e.g. engagement/progress)
      publicListableArticleWhere: (extra?: Record<string, unknown>) => ({ ...(extra ?? {}) }),
      publicLibraryArticleWhere: (extra?: Record<string, unknown>) => ({ ...(extra ?? {}) }),
      readableArticleWhere: (_ctx: unknown, extra?: Record<string, unknown>) => ({ ...(extra ?? {}) }),
      editableArticleWhere: (_ctx: unknown, extra?: Record<string, unknown>) => ({ ...(extra ?? {}) }),
      adminVisibleArticleWhere: (_ctx: unknown, extra?: Record<string, unknown>) => ({ ...(extra ?? {}) }),
      isArticleOperator: () => false,
      isPublicListableArticle: () => true,
      canReadArticle: () => true,
      canEditArticle: () => false,
      canAdminViewArticles: () => false,
      SYSTEM_ARTICLE_CONTEXT: { role: "System" },
      ARTICLE_STATUSES: [],
      PUBLIC_ARTICLE_CREATE_FIELDS: {},
      buildArticleListResponse: async (_userId: string, articles: unknown[]) => ({
        articles,
        progress: {},
        hasMore: false,
        offset: articles.length,
      }),
    },
  });

  const prismaMock = {
    article: {
      count: async () => importCount,
      findFirst: async () => importExisting,
      create: async (args: { data: Record<string, unknown> }) => {
        importCreateData = args.data;
        return { id: "import-1" };
      },
      update: async () => ({}),
      findMany: async () => [],
    },
    $transaction: async (fn: unknown) => {
      if (typeof fn === "function") {
        return (fn as (tx: unknown) => Promise<unknown>)(prismaMock);
      }
      return Promise.all(fn as Promise<unknown>[]);
    },
  };
  mock.module("@/lib/prisma", {
    namedExports: { prisma: prismaMock },
  });

  mock.module("@/lib/security/rate-limit/index", {
    namedExports: {
      checkRateLimit: () => {},
      checkRateLimitByKey: () => {},
      clientIpKey: () => "ip:test",
    },
  });

  mock.module("@/lib/scraper/ssrf", {
    namedExports: {
      assertSafeUrl: async (url: string) => {
        assertSafeCalls.push(url);
        if (assertSafeThrows) throw new Error("private address blocked");
      },
    },
  });

  mock.module("@/lib/scraper", {
    namedExports: {
      scrapeUrl: async (url: string) => {
        scrapeCalls.push(url);
        return scrapedArticle;
      },
      saveDraftArticle: async () => ({ status: "saved", id: "draft-1", article: scrapedArticle }),
    },
  });

  mock.module("@/lib/difficulty", {
    namedExports: {
      heuristicDifficulty: () => ({ level: "B1", score: 50 }),
      ensureArticleDifficulties: async () => {},
    },
  });

  mock.module("@/lib/article-library/listings", {
    namedExports: {
      listPersonalArticlesPage: async () => ({ articles: [], hasMore: false }),
      IMPORTS_PAGE_SIZE: 20,
      IMPORTS_MAX_LIMIT: 50,
    },
  });

  mock.module("@/lib/cache", {
    namedExports: {
      revalidateArticlesCache: () => {},
      revalidateTagsCache: () => {},
      createCachedListing:
        <T extends unknown[], R>(fn: (...args: T) => Promise<R>) =>
        (...args: T) =>
          fn(...args),
      ARTICLES_CACHE_TAG: "articles",
      TAGS_CACHE_TAG: "tags",
    },
  });

  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {
        articleImport: "article.import",
        securityAdminAccessDenied: "security.admin_access_denied",
      },
      auditRequestInfo: () => ({}),
      recordAuditFromRequest: async () => {
        auditCalls++;
      },
      tryRecordAuditLog: async () => {},
    },
  });
});

beforeEach(() => {
  authState = "ok";
  viewableArticle = null;
  viewableCalls = [];
  importCreateData = null;
  importCount = 0;
  importExisting = null;
  assertSafeCalls = [];
  assertSafeThrows = false;
  scrapeCalls = [];
  auditCalls = 0;
});

function jsonReq(body: unknown, url = "http://test/api/route"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(id = "private-article") {
  return { params: Promise.resolve({ id }) };
}

// ---------------------------------------------------------------------------
// Offline article HTML sanitization
// ---------------------------------------------------------------------------

describe("offline article payload sanitization", () => {
  test("sanitizes stored HTML before returning it", async () => {
    viewableArticle = buildArticle({
      id: "private-article",
      ownerId: "user-1",
      title: "Private",
      content:
        '<p>Safe text</p><img src="javascript:alert(1)" onerror="alert(2)">' +
        '<a href="javascript:alert(3)" onclick="alert(4)">bad</a><script>alert(5)</script>',
      publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const { GET } = (await import("@/app/api/reader/[id]/offline/route")) as { GET: RouteHandler };

    const res = await GET(new Request("http://test/api/reader/private-article/offline"), ctx("private-article"));

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.sanitizedHtml, /Safe text/);
    assert.doesNotMatch(body.sanitizedHtml, /script|onerror|onclick|javascript:|alert/i);
  });
});

// ---------------------------------------------------------------------------
// URL import SSRF protection
// ---------------------------------------------------------------------------

describe("URL import SSRF protection", () => {
  test("rejects unsafe URLs before scraping or creating rows", async () => {
    assertSafeThrows = true;
    const { POST } = (await import("@/app/api/articles/import/route")) as { POST: RouteHandler };

    const res = await POST(jsonReq({ url: "http://169.254.169.254/latest/meta-data" }));

    assert.equal(res.status, 422);
    assert.deepEqual(assertSafeCalls, ["http://169.254.169.254/latest/meta-data"]);
    assert.deepEqual(scrapeCalls, []);
    assert.equal(importCreateData, null);
  });
});

// ---------------------------------------------------------------------------
// Text import sanitization
// ---------------------------------------------------------------------------

describe("text import content sanitization", () => {
  test("stores sanitized private content owned by the caller", async () => {
    const { POST } = (await import("@/app/api/articles/import/route")) as { POST: RouteHandler };

    const res = await POST(
      jsonReq({
        title: "Pasted",
        text:
          'Hello <img src="javascript:alert(1)" onerror="alert(2)">\n\n' +
          '<script>alert(3)</script>World\n\n' +
          "This pasted personal article contains more than fifty words so that it " +
          "satisfies the minimum length requirement for text imports while still " +
          "exercising the HTML sanitization path thoroughly with several additional " +
          "sentences of harmless filler content that the sanitizer should preserve " +
          "verbatim as plain readable paragraph text here today and even more.",
      }),
    );

    assert.equal(res.status, 201);
    assert.equal(importCreateData?.ownerId, "user-1");
    assert.equal(importCreateData?.status, ArticleStatus.PUBLISHED);
    assert.equal(importCreateData?.visibility, ArticleVisibility.PRIVATE);
    assert.equal(importCreateData?.sourceType, ArticleSourceType.IMPORTED);
    assert.equal(importCreateData?.source, "Personal");
    assert.match(String(importCreateData?.content), /Hello/);
    assert.match(String(importCreateData?.content), /World/);
    assert.doesNotMatch(String(importCreateData?.content), /script|onerror|javascript:|alert/i);
  });
});
