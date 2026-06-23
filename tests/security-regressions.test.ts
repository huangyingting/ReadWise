process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { buildArticle } from "./helpers";
import { ArticleSourceType, ArticleStatus, ArticleVisibility } from "@prisma/client";

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;
type MockUser = { id?: string | null; role?: string | null } | null | undefined;
type MockAccessContext = { userId?: string | null; role?: string | null };

const session = { user: { id: "user-1", role: "Reader", name: "T", email: "t@e.com" } };

let authState: "ok" | "unauth" = "ok";
let viewableArticle: unknown = null;
let viewableCalls: Array<{ id: string; role?: string | null; userId?: string | null }> = [];
let rateLimitCalls: Array<{ userId: string; scope: string }> = [];
let helperCalls: string[] = [];
let pronunciationAttempts: unknown[] = [];
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

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () =>
        authState === "unauth"
          ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
          : { session },
      requireAdminApi: async () =>
        authState === "unauth"
          ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
          : { session },
    },
  });

  mock.module("@/lib/article-access", {
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
    },
  });

  mock.module("@/lib/articles", {
    namedExports: {
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
    },
  });

  mock.module("@/lib/rate-limit", {
    namedExports: {
      checkRateLimit: (userId: string, scope: string) => {
        rateLimitCalls.push({ userId, scope });
      },
      checkRateLimitByKey: (key: string, scope: string) => {
        rateLimitCalls.push({ userId: key, scope });
      },
      clientIpKey: () => "ip:test",
    },
  });

  mock.module("@/lib/translation", {
    namedExports: {
      isSupportedLanguage: () => true,
      getOrCreateTranslation: async () => {
        helperCalls.push("translation");
        return { lang: "es", content: "Hola", cached: false, fallback: false };
      },
      htmlToPlainText: (html: string) => html,
    },
  });

  mock.module("@/lib/vocabulary", {
    namedExports: {
      getOrCreateArticleVocabulary: async () => {
        helperCalls.push("vocabulary");
        return { articleId: "private-article", items: [], fallback: false };
      },
    },
  });

  mock.module("@/lib/quiz", {
    namedExports: {
      getOrCreateArticleQuiz: async () => {
        helperCalls.push("quiz");
        return { articleId: "private-article", questions: [], fallback: false };
      },
    },
  });

  mock.module("@/lib/speech", {
    namedExports: {
      getOrCreateArticleSpeech: async () => {
        helperCalls.push("speech");
        return { audioBase64: "AAAA", mimeType: "audio/mpeg", words: [] };
      },
    },
  });

  mock.module("@/lib/tags", {
    namedExports: {
      getOrCreateArticleTags: async () => {
        helperCalls.push("tags");
        return { articleId: "private-article", tags: [], fallback: false };
      },
    },
  });

  mock.module("@/lib/grammar", {
    namedExports: {
      MAX_PHRASE_CHARS: 500,
      MAX_CONTEXT_CHARS: 2000,
      explainGrammar: async () => {
        helperCalls.push("grammar");
        return { explanation: "ok", fallback: false };
      },
    },
  });

  mock.module("@/lib/tutor", {
    namedExports: {
      MAX_QUESTION_LENGTH: 1000,
      getTutorMessages: async () => {
        helperCalls.push("tutor:get");
        return [];
      },
      askTutor: async () => {
        helperCalls.push("tutor:post");
        return { answer: "ok", fallback: false, messages: [] };
      },
      clearTutor: async () => {
        helperCalls.push("tutor:delete");
      },
    },
  });

  mock.module("@/lib/pronunciation", {
    namedExports: {
      recordPronunciationAttempt: async (_userId: string, attempt: unknown) => {
        pronunciationAttempts.push(attempt);
        return { attempt: { id: "attempt-1" }, bestScore: 90 };
      },
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
    namedExports: {
      prisma: prismaMock,
    },
  });

  mock.module("@/lib/progress", {
    namedExports: {
      saveProgress: async () => {
        helperCalls.push("progress");
        return { percent: 50, completed: false };
      },
      getProgressSummaries: async () => ({}),
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

  mock.module("@/lib/audit", {
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
  rateLimitCalls = [];
  helperCalls = [];
  pronunciationAttempts = [];
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

const aiRouteCases = [
  {
    label: "translation",
    importPath: "@/app/api/reader/[id]/translate/route",
    body: { lang: "es" },
    helper: "translation",
  },
  {
    label: "vocabulary",
    importPath: "@/app/api/reader/[id]/vocabulary/route",
    body: {},
    helper: "vocabulary",
  },
  {
    label: "quiz",
    importPath: "@/app/api/reader/[id]/quiz/route",
    body: {},
    helper: "quiz",
  },
  {
    label: "speech",
    importPath: "@/app/api/reader/[id]/speech/route",
    body: {},
    helper: "speech",
  },
  {
    label: "tags",
    importPath: "@/app/api/reader/[id]/tags/route",
    body: {},
    helper: "tags",
  },
  {
    label: "grammar",
    importPath: "@/app/api/reader/[id]/grammar/route",
    body: { phrase: "ran", contextSentence: "He ran." },
    helper: "grammar",
  },
  {
    label: "tutor",
    importPath: "@/app/api/reader/[id]/tutor/route",
    body: { question: "What does this mean?" },
    helper: "tutor:post",
  },
] as const;

for (const routeCase of aiRouteCases) {
  test(`${routeCase.label} route hides non-viewable article ids before AI work`, async () => {
    viewableArticle = null;
    const { POST } = (await import(routeCase.importPath)) as { POST: RouteHandler };

    const res = await POST(jsonReq(routeCase.body), ctx("foreign-private"));

    assert.equal(res.status, 404);
    assert.deepEqual(viewableCalls, [
      { id: "foreign-private", role: "Reader", userId: "user-1" },
    ]);
    assert.equal(helperCalls.includes(routeCase.helper), false);
    assert.equal(rateLimitCalls.length, 0, "rate limit should not be consumed after an IDOR denial");
  });

  test(`${routeCase.label} route allows an owned private article and uses the user keyed AI limit`, async () => {
    viewableArticle = buildArticle({ id: "private-article", ownerId: "user-1", difficulty: "B1" });
    const { POST } = (await import(routeCase.importPath)) as { POST: RouteHandler };

    const res = await POST(jsonReq(routeCase.body), ctx("private-article"));

    assert.equal(res.status, 200);
    assert.deepEqual(viewableCalls.at(-1), {
      id: "private-article",
      role: "Reader",
      userId: "user-1",
    });
    assert.equal(helperCalls.includes(routeCase.helper), true);
    assert.deepEqual(rateLimitCalls.at(-1), { userId: "user-1", scope: "ai" });
  });
}

test("pronunciation attempts reject non-viewable article ids before persisting user-owned history", async () => {
  viewableArticle = null;
  const { POST } = (await import("@/app/api/pronunciation/attempt/route")) as { POST: RouteHandler };

  const res = await POST(
    jsonReq({
      referenceText: "hello world",
      accuracyScore: 80,
      fluencyScore: 81,
      completenessScore: 82,
      pronScore: 83,
      articleId: "foreign-private",
    }),
    undefined,
  );

  assert.equal(res.status, 404);
  assert.deepEqual(viewableCalls, [
    { id: "foreign-private", role: "Reader", userId: "user-1" },
  ]);
  assert.equal(pronunciationAttempts.length, 0);
  assert.deepEqual(rateLimitCalls, [{ userId: "user-1", scope: "ai" }]);
});

test("offline article payload sanitizes stored HTML before returning it", async () => {
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

test("personal URL import rejects unsafe URLs before scraping or creating rows", async () => {
  assertSafeThrows = true;
  const { POST } = (await import("@/app/api/articles/import/route")) as { POST: RouteHandler };

  const res = await POST(jsonReq({ url: "http://169.254.169.254/latest/meta-data" }));

  assert.equal(res.status, 422);
  assert.deepEqual(assertSafeCalls, ["http://169.254.169.254/latest/meta-data"]);
  assert.deepEqual(scrapeCalls, []);
  assert.equal(importCreateData, null);
});

test("personal text import stores sanitized private content owned by the caller", async () => {
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
