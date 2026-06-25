process.env.LOG_LEVEL = "error"; // silence request.start/complete logs
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { recordCacheAccess, resetMetrics } from "@/lib/metrics";

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;

// ---- mutable auth state -------------------------------------------------
let authState: "ok" | "unauth" | "forbidden" = "ok";
const session = { user: { id: "user-1", role: "Admin", name: "T", email: "t@e.com" } };

// ---- mutable lib return values -----------------------------------------
let articleExists = true;
let saveProgressResult = { percent: 50, completed: false };
let progressSummaries: Record<string, { percent: number; completed: boolean }> = {};
let translationResult: unknown = { lang: "es", content: "Hola", cached: false, fallback: false };
let supportedLang = true;
let vocabularyResult: unknown = { articleId: "a1", items: [], fallback: false };
let speechResult: unknown = { audioBase64: "AAAA", words: [] };
let quizResult: unknown = { articleId: "a1", questions: [], fallback: false };
let dictionaryResult: unknown = { word: "run", found: true, meanings: [] };
let searchArticlesResult: unknown = { articles: [], total: 0, page: 1 };
let deleteArticleResult = true;
let revalidateCalls = 0;
let lastSavedWord: unknown = null;
let auditCalls: unknown[] = [];

const AUDIT_ACTIONS = {
  adminArticleDelete: "admin.article.delete",
  securityAdminAccessDenied: "security.admin_access_denied",
  adminAuditLogRead: "admin.audit_logs.read",
};

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () =>
        authState === "unauth"
          ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
          : { session },
      requireCapabilityApi: async () => {
        if (authState === "unauth")
          return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
        if (authState === "forbidden")
          return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
        return { session };
      },
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findUnique: async () => (articleExists ? { id: "a1" } : null),
          findFirst: async () => (articleExists ? { id: "a1" } : null),
        },
      },
    },
  });
  mock.module("@/lib/engagement/progress", {
    namedExports: {
      saveProgress: async () => saveProgressResult,
      getProgressSummaries: async () => progressSummaries,
    },
  });
  mock.module("@/lib/translation", {
    namedExports: {
      getOrCreateTranslation: async () => translationResult,
      isSupportedLanguage: () => supportedLang,
      articleHtmlToReaderText: (html: string) => html,
    },
  });
  mock.module("@/lib/vocabulary", {
    namedExports: {
      getOrCreateArticleVocabulary: async () => vocabularyResult,
    },
  });
  mock.module("@/lib/lexical/saved-words", {
    namedExports: {
      saveWord: async (_userId: string, entry: unknown) => {
        lastSavedWord = entry;
      },
    },
  });
  mock.module("@/lib/speech", {
    namedExports: { getOrCreateArticleSpeech: async () => speechResult },
  });
  mock.module("@/lib/quiz", {
    namedExports: { getOrCreateArticleQuiz: async () => quizResult },
  });
  mock.module("@/lib/lexical/lookup", {
    namedExports: { lookupWord: async () => dictionaryResult },
  });
  mock.module("@/lib/article-library", {
    namedExports: {
      ARTICLE_STATUSES: ["draft", "processing", "published", "failed", "archived"],
      REVIEW_STATES: ["pending", "approved", "rejected"],
      TAKEDOWN_STATES: ["none", "requested", "removed"],
      articleAccessContext: () => ({ kind: "user", userId: session.user.id, role: session.user.role }),
      getReadableArticleById: async () => (articleExists ? { id: "a1", status: "published" } : null),
      searchArticles: async () => searchArticlesResult,
      deleteArticle: async (_id: string, _ctx: unknown, audit?: unknown) => {
        if (!deleteArticleResult) return false;
        if (audit) auditCalls.push(audit);
        return true;
      },
      getViewableArticleById: async () => (articleExists ? { id: "a1", status: "published" } : null),
    },
  });
  mock.module("@/lib/cache", {
    namedExports: {
      revalidateTagsCache: () => {
        revalidateCalls++;
      },
      revalidateArticlesCache: () => {},
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
      AUDIT_ACTIONS,
      auditRequestInfo: () => ({}),
      recordAuditFromRequest: async (input: unknown) => {
        auditCalls.push(input);
      },
      tryRecordAuditLog: async (input: unknown) => {
        auditCalls.push(input);
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  articleExists = true;
  saveProgressResult = { percent: 50, completed: false };
  progressSummaries = {};
  supportedLang = true;
  revalidateCalls = 0;
  lastSavedWord = null;
  deleteArticleResult = true;
  auditCalls = [];
  resetMetrics();
});

function jsonReq(body: unknown): Request {
  return new Request("http://test/api/route", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(id = "a1") {
  return { params: Promise.resolve({ id }) };
}

// ---- progress -----------------------------------------------------------
test("POST progress saves and returns percent/completed", async () => {
  saveProgressResult = { percent: 80, completed: false };
  const { POST } = (await import("@/app/api/reader/[id]/progress/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ percent: 80 }), ctx());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { percent: 80, completed: false });
  assert.equal(res.headers.get("x-request-id")?.length ? true : false, true);
});

test("POST progress returns 404 for a missing article", async () => {
  articleExists = false;
  const { POST } = (await import("@/app/api/reader/[id]/progress/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ percent: 10 }), ctx());
  assert.equal(res.status, 404);
});

test("POST progress returns 400 for an invalid body", async () => {
  const { POST } = (await import("@/app/api/reader/[id]/progress/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ percent: "lots" }), ctx());
  assert.equal(res.status, 400);
});

test("POST progress returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { POST } = (await import("@/app/api/reader/[id]/progress/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ percent: 10 }), ctx());
  assert.equal(res.status, 401);
});

// ---- translate ----------------------------------------------------------
test("POST translate returns the translation result", async () => {
  const { POST } = (await import("@/app/api/reader/[id]/translate/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ lang: "es" }), ctx());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).content, "Hola");
});

test("POST translate rejects an unsupported language", async () => {
  supportedLang = false;
  const { POST } = (await import("@/app/api/reader/[id]/translate/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ lang: "zz" }), ctx());
  assert.equal(res.status, 400);
});

test("POST translate returns 404 when the article is missing", async () => {
  translationResult = null;
  const { POST } = (await import("@/app/api/reader/[id]/translate/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ lang: "es" }), ctx());
  assert.equal(res.status, 404);
  translationResult = { lang: "es", content: "Hola", cached: false, fallback: false };
});

// ---- vocabulary / speech / quiz ----------------------------------------
test("POST vocabulary returns extracted items", async () => {
  vocabularyResult = { articleId: "a1", items: [{ word: "x" }], fallback: false };
  const { POST } = (await import("@/app/api/reader/[id]/vocabulary/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({}), ctx());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).items.length, 1);
});

test("POST vocabulary returns 404 when null", async () => {
  vocabularyResult = null;
  const { POST } = (await import("@/app/api/reader/[id]/vocabulary/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({}), ctx());
  assert.equal(res.status, 404);
  vocabularyResult = { articleId: "a1", items: [], fallback: false };
});

test("POST speech returns audio payload", async () => {
  const { POST } = (await import("@/app/api/reader/[id]/speech/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({}), ctx());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).audioBase64, "AAAA");
});

test("POST quiz returns questions", async () => {
  quizResult = { articleId: "a1", questions: [{ question: "Q" }], fallback: false };
  const { POST } = (await import("@/app/api/reader/[id]/quiz/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({}), ctx());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).questions.length, 1);
});

// ---- dictionary / vocabulary save --------------------------------------
test("POST dictionary looks up a word", async () => {
  const { POST } = (await import("@/app/api/dictionary/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ word: "run" }), undefined);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).found, true);
});

test("POST dictionary returns 400 without a word", async () => {
  const { POST } = (await import("@/app/api/dictionary/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({}), undefined);
  assert.equal(res.status, 400);
});

test("POST vocabulary/save persists the word for the user", async () => {
  const { POST } = (await import("@/app/api/vocabulary/save/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ word: "serendipity" }), undefined);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { word: "serendipity", saved: true });
  assert.equal((lastSavedWord as { word: string }).word, "serendipity");
});

// ---- progress batch -----------------------------------------------------
test("POST progress/batch returns summaries for ids", async () => {
  progressSummaries = { a1: { percent: 30, completed: false } };
  const { POST } = (await import("@/app/api/progress/batch/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ ids: ["a1"] }), undefined);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { progress: { a1: { percent: 30, completed: false } } });
});

// ---- admin --------------------------------------------------------------
test("GET admin/articles requires admin and returns search results", async () => {
  searchArticlesResult = { articles: [{ id: "a1" }], total: 1, page: 1 };
  const { GET } = (await import("@/app/api/admin/articles/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/admin/articles?q=foo"), undefined);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).total, 1);
});

test("GET admin/articles returns 403 for non-admins", async () => {
  authState = "forbidden";
  const { GET } = (await import("@/app/api/admin/articles/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/admin/articles"), undefined);
  assert.equal(res.status, 403);
  assert.equal((auditCalls[0] as { action: string }).action, "security.admin_access_denied");
});

test("DELETE admin/articles/[id] deletes and revalidates cache", async () => {
  const { DELETE } = (await import("@/app/api/admin/articles/[id]/route")) as { DELETE: RouteHandler };
  const res = await DELETE(new Request("http://test/x", { method: "DELETE" }), ctx());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(revalidateCalls, 1);
  assert.equal((auditCalls[0] as { action: string; targetId: string }).action, "admin.article.delete");
  assert.equal((auditCalls[0] as { targetId: string }).targetId, "a1");
});

test("DELETE admin/articles/[id] returns 404 when not found", async () => {
  deleteArticleResult = false;
  const { DELETE } = (await import("@/app/api/admin/articles/[id]/route")) as { DELETE: RouteHandler };
  const res = await DELETE(new Request("http://test/x", { method: "DELETE" }), ctx());
  assert.equal(res.status, 404);
  assert.equal(revalidateCalls, 0);
});

test("GET admin/metrics exports Prometheus text for admins", async () => {
  recordCacheAccess("articles:published", "miss");
  const { GET } = (await import("@/app/api/admin/metrics/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/admin/metrics"), undefined);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/plain/);
  assert.match(await res.text(), /readwise_cache_access_total/);
});
