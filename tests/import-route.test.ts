process.env.LOG_LEVEL = "error";
/**
 * Tests for POST /api/articles/import (Issue #116).
 * Verifies: auth guard, rate-limit, URL/text validation, ownership.
 */
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

// ---- mutable auth state --------------------------------------------------
let authOk = true;
const session = { user: { id: "user-1", role: "Reader", name: "T", email: "t@e.com" } };

// ---- mutable prisma stubs ------------------------------------------------
let countResult = 0; // number of today's imports
let createdId = "new-article-id";
let scrapeResult: unknown = {
  title: "My Article",
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
let scrapeThrows = false;
let ssrfThrows = false;
let updateCalled = false;

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () =>
        authOk
          ? { session }
          : { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) },
      requireAdminApi: async () =>
        authOk
          ? { session }
          : { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) },
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          count: async () => countResult,
          create: async () => ({ id: createdId }),
          update: async () => { updateCalled = true; return { id: createdId }; },
        },
      },
    },
  });

  mock.module("@/lib/scraper/ssrf", {
    namedExports: {
      assertSafeUrl: async () => {
        if (ssrfThrows) throw new Error("Unsafe URL: private address");
      },
    },
  });

  mock.module("@/lib/scraper", {
    namedExports: {
      scrapeUrl: async () => {
        if (scrapeThrows) throw new Error("Network error");
        return scrapeResult;
      },
      saveDraftArticle: async () => ({ status: "saved", id: createdId, article: scrapeResult }),
    },
  });

  mock.module("@/lib/sanitize", {
    namedExports: {
      sanitizeArticleHtml: (html: string) => html,
    },
  });

  mock.module("@/lib/articles", {
    namedExports: {
      countWords: (text: string) => text.split(/\s+/).filter(Boolean).length,
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
    },
  });
});

beforeEach(() => {
  authOk = true;
  countResult = 0;
  scrapeThrows = false;
  ssrfThrows = false;
  updateCalled = false;
  createdId = "new-article-id";
  scrapeResult = {
    title: "My Article",
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
});

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;

async function makeReq(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/articles/import/route") as { POST: RouteHandler };
  return POST(
    new Request("http://localhost/api/articles/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

// ---------------------------------------------------------------------------

test("401 when not authenticated", async () => {
  authOk = false;
  const res = await makeReq({ url: "https://example.com/article" });
  assert.equal(res.status, 401);
});

test("URL import succeeds with valid URL and returns article id", async () => {
  const res = await makeReq({ url: "https://example.com/article" });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.id, createdId);
});

test("text import succeeds with title + text", async () => {
  const res = await makeReq({ title: "My Title", text: "First paragraph.\n\nSecond paragraph." });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.id, createdId);
});

test("text import uses Untitled import when no title provided", async () => {
  const res = await makeReq({ text: "Some content here with enough words." });
  assert.equal(res.status, 201);
});

test("400 when neither url nor text is provided", async () => {
  const res = await makeReq({ title: "Only a title" });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error.includes("url") || data.error.includes("text"));
});

test("400 when text is empty string", async () => {
  const res = await makeReq({ text: "   " });
  assert.equal(res.status, 400);
});

test("429 when daily import limit is reached", async () => {
  countResult = 5; // already at limit
  const res = await makeReq({ url: "https://example.com/article" });
  assert.equal(res.status, 429);
  const data = await res.json();
  assert.ok(data.error.toLowerCase().includes("limit"));
});

test("422 when SSRF guard rejects the URL", async () => {
  ssrfThrows = true;
  const res = await makeReq({ url: "https://192.168.1.1/evil" });
  assert.equal(res.status, 422);
  const data = await res.json();
  assert.ok(data.error.includes("unsafe") || data.error.includes("Unsafe") || data.error.includes("Invalid"));
});

test("422 when scraper throws (network error)", async () => {
  scrapeThrows = true;
  const res = await makeReq({ url: "https://example.com/article" });
  assert.equal(res.status, 422);
});

test("422 when scraper returns null (extraction failed)", async () => {
  scrapeResult = null;
  const res = await makeReq({ url: "https://example.com/article" });
  assert.equal(res.status, 422);
  const data = await res.json();
  assert.ok(data.error.toLowerCase().includes("extract") || data.error.toLowerCase().includes("content"));
});
