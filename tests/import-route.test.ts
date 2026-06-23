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
let createCalled = false;
let findFirstResult: { id: string } | null = null;
let auditCalls = 0;
let createArgs: { data?: { content?: string } } | null = null;
let sanitizeCalls: string[] = [];
let prismaStub: Record<string, unknown>;

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

  prismaStub = {
    article: {
      count: async () => countResult,
      findFirst: async () => findFirstResult,
      create: async (args: unknown) => { createCalled = true; createArgs = args as typeof createArgs; return { id: createdId }; },
      update: async () => { updateCalled = true; return { id: createdId }; },
      findMany: async () => [],
    },
    $transaction: async (fn: unknown) => {
      if (typeof fn === "function") {
        return (fn as (tx: unknown) => Promise<unknown>)(prismaStub);
      }
      return Promise.all(fn as Promise<unknown>[]);
    },
  };
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: prismaStub,
    },
  });

  mock.module("@/lib/scraper/ssrf", {
    namedExports: {
      assertSafeUrl: async (raw: string) => {
        if (ssrfThrows) throw new Error("Unsafe URL: private address");
        // Mirror the real guard's protocol allowlist + URL parse so the route's
        // 422 handling for dangerous schemes / malformed URLs is exercised.
        const u = new URL(raw);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          throw new Error(`Only http(s) URLs are allowed (got ${u.protocol})`);
        }
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
      // Minimal real-ish sanitizer so route tests can assert stored HTML is
      // cleaned (no <script> / inline handlers) BEFORE persistence.
      sanitizeArticleHtml: (html: string) => {
        sanitizeCalls.push(html);
        return html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
      },
    },
  });

  mock.module("@/lib/articles", {
    namedExports: {
      countWords: (text: string) => text.split(/\s+/).filter(Boolean).length,
      toListingArticle: (a: { id: string }) => a,
      listPersonalArticlesPage: async () => ({ articles: [], hasMore: false }),
      IMPORTS_PAGE_SIZE: 20,
      IMPORTS_MAX_LIMIT: 50,
    },
  });

  mock.module("@/lib/progress", {
    namedExports: {
      getProgressSummaries: async () => ({}),
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
  authOk = true;
  countResult = 0;
  scrapeThrows = false;
  ssrfThrows = false;
  updateCalled = false;
  createCalled = false;
  findFirstResult = null;
  createdId = "new-article-id";
  auditCalls = 0;
  createArgs = null;
  sanitizeCalls = [];
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
  assert.equal(auditCalls, 1);
});

test("text import succeeds with title + text", async () => {
  const res = await makeReq({ title: "My Title", text: "word ".repeat(55).trim() });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.id, createdId);
});

test("text import uses Untitled import when no title provided", async () => {
  const res = await makeReq({ text: "word ".repeat(55).trim() });
  assert.equal(res.status, 201);
});

test("400 when text is too short (below minimum word count)", async () => {
  const res = await makeReq({ title: "Short", text: "Too short." });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(
    data.error.toLowerCase().includes("short") || data.error.toLowerCase().includes("minimum"),
    `expected min-word error but got: ${data.error}`,
  );
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

test("422 for a non-http(s) protocol URL (file:)", async () => {
  const res = await makeReq({ url: "file:///etc/passwd" });
  assert.equal(res.status, 422);
  const data = await res.json();
  assert.ok(data.error.toLowerCase().includes("http") || data.error.toLowerCase().includes("unsafe"));
  // The dangerous URL must never reach the scraper / DB.
  assert.equal(createCalled, false);
});

test("422 for a gopher: protocol URL", async () => {
  const res = await makeReq({ url: "gopher://169.254.169.254/" });
  assert.equal(res.status, 422);
  assert.equal(createCalled, false);
});

test("422 for a malformed URL string", async () => {
  const res = await makeReq({ url: "http://" });
  assert.equal(res.status, 422);
  assert.equal(createCalled, false);
});

test("text import sanitizes HTML before storing (strips script/onerror)", async () => {
  const safeBody = "word ".repeat(50).trim();
  const res = await makeReq({
    title: "XSS Attempt",
    text: `${safeBody}\n\n<script>alert('xss')</script> world <img src=x onerror=alert(1)> more text here.`,
  });
  assert.equal(res.status, 201);
  // Sanitizer was invoked on the wrapped HTML...
  assert.ok(sanitizeCalls.length >= 1, "sanitizeArticleHtml should be called");
  // ...and the persisted content contains no dangerous constructs.
  const stored = createArgs?.data?.content ?? "";
  assert.doesNotMatch(stored, /<script/i);
  assert.doesNotMatch(stored, /onerror/i);
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

test("duplicate URL import returns 200 with duplicate flag and does not create or consume quota", async () => {
  findFirstResult = { id: "existing-id" };
  // Even at the daily limit, a duplicate must NOT 429 (dedupe happens first).
  countResult = 5;
  const res = await makeReq({ url: "https://example.com/article" });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.duplicate, true);
  assert.equal(data.id, "existing-id");
  assert.equal(createCalled, false);
});

test("non-duplicate URL import at the daily limit returns 429 (quota checked after dedupe)", async () => {
  findFirstResult = null;
  countResult = 5;
  const res = await makeReq({ url: "https://example.com/article" });
  assert.equal(res.status, 429);
  assert.equal(createCalled, false);
});
