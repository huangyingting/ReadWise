/**
 * Tests for src/lib/reader/page-loader.ts.
 *
 * Covers buildArticleJsonLd (pure schema.org builder) and loadReaderPageData
 * (the full server-side reader data pipeline), including:
 *   - null return when article not found
 *   - successful load with related articles
 *   - fallback to category articles when no related
 *   - bookmarked / completed / difficulty-vote state
 *   - CEFR level validation
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ── Mock state ────────────────────────────────────────────────────────────

type MockArticle = {
  id: string;
  title: string;
  content: string;
  category: string | null;
  difficulty: string | null;
  author: string | null;
  source: string | null;
  publishedAt: Date | null;
  heroImage: string | null;
  wordCount: number | null;
  readingMinutes: number | null;
  status: string;
};

function makeArticle(overrides: Partial<MockArticle> = {}): MockArticle {
  return {
    id: "article-test",
    title: "Test Article",
    content: "<p>Article content.</p>",
    category: "tech",
    difficulty: "B1",
    author: "Test Author",
    source: "Test Source",
    publishedAt: new Date("2026-01-01"),
    heroImage: null,
    wordCount: 100,
    readingMinutes: 2,
    status: "PUBLISHED",
    ...overrides,
  };
}

let mockFoundArticle: MockArticle | null = null;
let mockRelatedArticles: MockArticle[] = [];
let mockFallbackArticles: MockArticle[] = [];
let mockProgress: { completed: boolean } | null = null;
let mockDifficultyLevel: { level: string } | null = { level: "B1" };
let mockDifficultyVote: { vote: string } | null = null;
let mockListMembership: { isDefault: boolean; hasArticle: boolean }[] = [];
let recordEventCalled = false;

before(() => {
  mock.module("@/lib/article-library/policy", {
    namedExports: {
      articleAccessContextForUser: async (_user: unknown) => ({}),
      getReadableArticleById: async (_id: unknown, _ctx: unknown) => mockFoundArticle,
    },
  });

  mock.module("@/lib/engagement", {
    namedExports: {
      getProgress: async (_userId: unknown, _articleId: unknown) => mockProgress,
      getProgressMap: async (_userId: unknown, _ids: unknown) => new Map(),
    },
  });

  mock.module("@/lib/difficulty", {
    namedExports: {
      getOrCreateArticleDifficulty: async (_id: unknown, _ctx: unknown) => mockDifficultyLevel,
    },
  });

  mock.module("@/lib/article-library/collections/tags", {
    namedExports: {
      getOrCreateArticleTags: async (_id: unknown, _ctx: unknown) => ({ tags: [] }),
      listRelatedArticles: async (_id: unknown) => mockRelatedArticles,
    },
  });

  mock.module("@/lib/article-library/collections/membership", {
    namedExports: {
      getArticleListMembership: async (_userId: unknown, _articleId: unknown, _role: unknown) =>
        mockListMembership,
    },
  });

  mock.module("@/lib/article-library/listings", {
    namedExports: {
      listCategoryPage: async (_category: unknown, _opts: unknown) => ({
        articles: mockFallbackArticles,
      }),
    },
  });

  mock.module("@/lib/article-library/mapper", {
    namedExports: {
      readingMinutesFor: (_article: unknown) => 3,
    },
  });

  mock.module("@/lib/content-pipeline", {
    namedExports: {
      sanitizeArticleHtml: (html: unknown) => String(html),
      articleHtmlToReaderTextFromSanitized: (html: unknown) => String(html),
    },
  });

  mock.module("@/lib/analytics/events", {
    namedExports: {
      recordEvent: async (_event: unknown) => {
        recordEventCalled = true;
      },
      ANALYTICS_EVENT_TYPES: { articleView: "article_view" },
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        articleDifficultyFeedback: {
          findUnique: async (_args: unknown) => mockDifficultyVote,
        },
      },
    },
  });
});

beforeEach(() => {
  mockFoundArticle = makeArticle();
  mockRelatedArticles = [];
  mockFallbackArticles = [];
  mockProgress = null;
  mockDifficultyLevel = { level: "B1" };
  mockDifficultyVote = null;
  mockListMembership = [];
  recordEventCalled = false;
});

const mockSession = {
  user: { id: "user-123", role: "Reader", email: "test@example.com" },
  expires: new Date(Date.now() + 3600_000).toISOString(),
};

// ── loadReaderPageData ────────────────────────────────────────────────────

test("loadReaderPageData returns null when article is not found", async () => {
  mockFoundArticle = null;
  const { loadReaderPageData } = await import("@/lib/reader/page-loader");
  const result = await loadReaderPageData("missing-id", mockSession as any);
  assert.equal(result, null);
});

test("loadReaderPageData returns full data when article exists", async () => {
  const { loadReaderPageData } = await import("@/lib/reader/page-loader");
  const result = await loadReaderPageData("article-test", mockSession as any);
  assert.ok(result !== null);
  assert.equal(result.article.id, "article-test");
  assert.equal(result.difficultyLevel, "B1");
  assert.equal(result.isValidCefrLevel, true);
  assert.deepEqual(result.tags, []);
  assert.equal(result.hadRelated, false);
  assert.equal(result.isBookmarked, false);
  assert.equal(result.isCompleted, false);
  assert.equal(result.userDifficultyVote, null);
  assert.ok(recordEventCalled, "analytics event should be recorded");
});

test("loadReaderPageData sets isCompleted when progress.completed is true", async () => {
  mockProgress = { completed: true };
  const { loadReaderPageData } = await import("@/lib/reader/page-loader");
  const result = await loadReaderPageData("article-test", mockSession as any);
  assert.ok(result !== null);
  assert.equal(result.isCompleted, true);
});

test("loadReaderPageData sets isBookmarked when default list has article", async () => {
  mockListMembership = [{ isDefault: true, hasArticle: true }];
  const { loadReaderPageData } = await import("@/lib/reader/page-loader");
  const result = await loadReaderPageData("article-test", mockSession as any);
  assert.ok(result !== null);
  assert.equal(result.isBookmarked, true);
});

test("loadReaderPageData uses hadRelated=true when related articles exist", async () => {
  mockRelatedArticles = [
    makeArticle({ id: "related-1" }),
    makeArticle({ id: "related-2" }),
    makeArticle({ id: "related-3" }),
  ];
  const { loadReaderPageData } = await import("@/lib/reader/page-loader");
  const result = await loadReaderPageData("article-test", mockSession as any);
  assert.ok(result !== null);
  assert.equal(result.hadRelated, true);
  assert.equal(result.keepReadingArticles.length, 3);
});

test("loadReaderPageData falls back to category articles when no related", async () => {
  mockRelatedArticles = [];
  mockFallbackArticles = [
    makeArticle({ id: "cat-1" }),
    makeArticle({ id: "cat-2" }),
    makeArticle({ id: "cat-3" }),
    makeArticle({ id: "cat-4" }),
  ];
  const { loadReaderPageData } = await import("@/lib/reader/page-loader");
  const result = await loadReaderPageData("article-test", mockSession as any);
  assert.ok(result !== null);
  assert.equal(result.hadRelated, false);
  assert.ok(result.keepReadingArticles.length <= 3, "at most 3 keep-reading articles from fallback");
});

test("loadReaderPageData passes userDifficultyVote from feedback", async () => {
  mockDifficultyVote = { vote: "too_easy" };
  const { loadReaderPageData } = await import("@/lib/reader/page-loader");
  const result = await loadReaderPageData("article-test", mockSession as any);
  assert.ok(result !== null);
  assert.equal(result.userDifficultyVote, "too_easy");
});

test("loadReaderPageData isValidCefrLevel is false for unrecognised level", async () => {
  mockFoundArticle = makeArticle({ difficulty: "X9" });
  mockDifficultyLevel = { level: "X9" };
  const { loadReaderPageData } = await import("@/lib/reader/page-loader");
  const result = await loadReaderPageData("article-test", mockSession as any);
  assert.ok(result !== null);
  assert.equal(result.isValidCefrLevel, false);
});

test("loadReaderPageData falls back to article.difficulty when no difficulty record", async () => {
  mockDifficultyLevel = null;
  mockFoundArticle = makeArticle({ difficulty: "C1" });
  const { loadReaderPageData } = await import("@/lib/reader/page-loader");
  const result = await loadReaderPageData("article-test", mockSession as any);
  assert.ok(result !== null);
  assert.equal(result.difficultyLevel, "C1");
});

test("loadReaderPageData excludes current article from category fallback", async () => {
  mockRelatedArticles = [];
  mockFallbackArticles = [
    makeArticle({ id: "article-test" }),  // same as current — should be excluded
    makeArticle({ id: "cat-2" }),
    makeArticle({ id: "cat-3" }),
  ];
  const { loadReaderPageData } = await import("@/lib/reader/page-loader");
  const result = await loadReaderPageData("article-test", mockSession as any);
  assert.ok(result !== null);
  assert.equal(result.hadRelated, false);
  const ids = result.keepReadingArticles.map((a: MockArticle) => a.id);
  assert.ok(!ids.includes("article-test"), "current article must not appear in keep-reading");
});

// ── buildArticleJsonLd ────────────────────────────────────────────────────

test("buildArticleJsonLd produces valid schema.org NewsArticle shape", async () => {
  const { buildArticleJsonLd } = await import("@/lib/reader/page-loader");
  const article = {
    title: "Test Article",
    author: "Jane Doe",
    source: "ReadWise Blog",
    publishedAt: new Date("2026-03-15T10:00:00Z"),
    heroImage: "https://example.com/img.jpg",
  };
  const result = buildArticleJsonLd(article, "A short description");

  assert.equal(result["@context"], "https://schema.org");
  assert.equal(result["@type"], "NewsArticle");
  assert.equal(result.headline, "Test Article");
  assert.deepEqual(result.author, { "@type": "Person", name: "Jane Doe" });
  assert.deepEqual(result.publisher, { "@type": "Organization", name: "ReadWise Blog" });
  assert.equal(result.datePublished, "2026-03-15T10:00:00.000Z");
  assert.equal(result.image, "https://example.com/img.jpg");
});

test("buildArticleJsonLd omits optional fields when absent", async () => {
  const { buildArticleJsonLd } = await import("@/lib/reader/page-loader");
  const article = {
    title: "Minimal",
    author: null,
    source: null,
    publishedAt: null,
    heroImage: null,
  };
  const result = buildArticleJsonLd(article, "desc");

  assert.equal(result.headline, "Minimal");
  assert.equal("author" in result, false);
  assert.deepEqual(result.publisher, { "@type": "Organization", name: "ReadWise" });
  assert.equal("datePublished" in result, false);
  assert.equal("image" in result, false);
});

test("buildArticleJsonLd truncates description to 200 chars", async () => {
  const { buildArticleJsonLd } = await import("@/lib/reader/page-loader");
  const article = {
    title: "Long Desc",
    author: null,
    source: "Src",
    publishedAt: null,
    heroImage: null,
  };
  const longDesc = "A".repeat(300);
  const result = buildArticleJsonLd(article, longDesc);

  assert.equal(typeof result.description, "string");
  assert.ok((result.description as string).length <= 200);
});

test("buildArticleJsonLd normalizes whitespace in description", async () => {
  const { buildArticleJsonLd } = await import("@/lib/reader/page-loader");
  const article = {
    title: "Whitespace",
    author: null,
    source: null,
    publishedAt: null,
    heroImage: null,
  };
  const result = buildArticleJsonLd(article, "  multiple   spaces\n\nnewlines  ");
  assert.equal(result.description, "multiple spaces newlines");
});
