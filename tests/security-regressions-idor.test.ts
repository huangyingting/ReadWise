/**
 * Security regression tests — IDOR protection.
 *
 * Verifies that AI-enrichment routes and the pronunciation-attempt route
 * gate on article visibility BEFORE performing any work, preventing
 * information-disclosure via private foreign article IDs.
 *
 * Mocks: @/lib/api-auth, @/lib/article-library, @/lib/security/rate-limit/index,
 *        @/lib/translation, @/lib/vocabulary, @/lib/quiz, @/lib/speech, @/lib/grammar,
 *        @/lib/ai/tutor, @/lib/pronunciation, @/lib/prisma.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock, describe } from "node:test";
import assert from "node:assert/strict";
import { buildArticle } from "./helpers";
import { ArticleVisibility, ArticleSourceType } from "@prisma/client";
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
let rateLimitCalls: Array<{ userId: string; scope: string }> = [];
let helperCalls: string[] = [];
let pronunciationAttempts: unknown[] = [];

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
      findOwnedArticleBySourceUrl: async () => null,
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
      getOrCreateArticleTags: async () => {
        helperCalls.push("tags");
        return { articleId: "private-article", tags: [], fallback: false };
      },
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
    },
  });

  mock.module("@/lib/security/rate-limit/index", {
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
      articleHtmlToReaderText: (html: string) => html,
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
        return { audio: "data:audio/mpeg;base64,AAAA", mimeType: "audio/mpeg", words: [] };
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

  mock.module("@/lib/ai/tutor", {
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
      count: async () => 0,
      findFirst: async () => null,
      create: async () => ({ id: "import-1" }),
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

  mock.module("@/lib/engagement/progress", {
    namedExports: {
      COMPLETION_THRESHOLD: 95,
      clampPercent: (v: number) => Math.max(0, Math.min(100, v)),
      getProgress: async () => null,
      getProgressMap: async () => ({}),
      getProgressSummaries: async () => ({}),
      listInProgressArticles: async () => ({ articles: [], hasMore: false }),
      saveProgress: async () => {
        helperCalls.push("progress");
        return { percent: 50, completed: false };
      },
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
// AI route IDOR protection
// ---------------------------------------------------------------------------

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

describe("AI route IDOR protection — gates on article visibility before AI work", () => {
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
});

// ---------------------------------------------------------------------------
// Pronunciation IDOR protection
// ---------------------------------------------------------------------------

describe("pronunciation attempt IDOR protection", () => {
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
});
