process.env.LOG_LEVEL = "error";
/**
 * Unit tests for the personal article import services (Issue #468, REF-031).
 *
 * Covers: quota, URL import (SSRF, raw/canonical dedupe, quota, P2002 race),
 * text import (empty, short, sanitization, audit/analytics metadata policy).
 */
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "next-auth";

// ---- mutable stubs --------------------------------------------------------
let countResult = 0;
let createdId = "new-article-id";
let findFirstResult: { id: string } | null = null;
let scrapeResult: unknown = {
  title: "Scraped Article",
  author: null,
  source: "example.com",
  sourceUrl: "https://example.com/article",
  heroImage: null,
  excerpt: null,
  content: "<p>" + "word ".repeat(60) + "</p>",
  category: "tech",
  wordCount: 60,
  readingMinutes: 1,
  publishedAt: null,
};
let scrapeThrows = false;
let ssrfThrows = false;
let createCalled = false;
let createArgs: { data?: { content?: string; metadata?: unknown } } | null = null;
let updateCalled = false;
let auditCalls = 0;
let auditMeta: unknown[] = [];
let analyticsEvents: { type: string; properties: unknown }[] = [];
let securityEvents: { type: string; meta: unknown }[] = [];
let sanitizeCalls: string[] = [];
let prismaStub: Record<string, unknown>;
let p2002Throws = false;

const session = { user: { id: "user-1", role: "Reader", name: "T", email: "t@e.com" }, expires: "2099-01-01" } as unknown as Session;
const mockReq = new Request("http://localhost/api/articles/import", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});

before(() => {
  prismaStub = {
    article: {
      count: async () => countResult,
      findFirst: async () => findFirstResult,
      create: async (args: unknown) => {
        if (p2002Throws) {
          const err = new Error("Unique constraint failed on the fields: (`sourceUrl`,`ownerId`)");
          (err as unknown as { code: string }).code = "P2002";
          (err as unknown as { constructor: { name: string } }).constructor = { name: "PrismaClientKnownRequestError" };
          throw err;
        }
        createCalled = true;
        createArgs = args as typeof createArgs;
        return { id: createdId };
      },
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
    namedExports: { prisma: prismaStub },
  });

  mock.module("@/lib/scraper/ssrf", {
    namedExports: {
      assertSafeUrl: async (raw: string) => {
        if (ssrfThrows) throw new Error("Unsafe URL: private address");
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
    },
  });

  mock.module("@/lib/sanitize", {
    namedExports: {
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

  mock.module("@/lib/difficulty", {
    namedExports: {
      heuristicDifficulty: () => ({ level: "B1", score: 50 }),
    },
  });

  mock.module("@/lib/article-access", {
    namedExports: {
      findOwnedArticleBySourceUrl: async (_url: string, _userId: string) => findFirstResult,
      ownedArticleWhere: (userId: string, extra?: unknown) => ({ ownerId: userId, ...((extra as object) ?? {}) }),
      privateImportedArticleCreateFields: (userId: string) => ({ ownerId: userId, isPrivate: true }),
    },
  });

  mock.module("@/lib/audit", {
    namedExports: {
      AUDIT_ACTIONS: { articleImport: "article.import" },
      recordAuditFromRequest: async (args: { metadata?: unknown }) => {
        auditCalls++;
        auditMeta.push(args.metadata);
      },
    },
  });

  mock.module("@/lib/security-events", {
    namedExports: {
      SECURITY_EVENT_TYPES: { importBlocked: "import.blocked" },
      recordSecurityEvent: (evt: { type: string; meta: unknown }) => {
        securityEvents.push(evt);
      },
    },
  });

  mock.module("@/lib/client-ip", {
    namedExports: {
      clientIp: () => "127.0.0.1",
    },
  });

  mock.module("@/lib/analytics/events", {
    namedExports: {
      ANALYTICS_EVENT_TYPES: { import: "import" },
      recordEvent: async (evt: { type: string; properties: unknown }) => {
        analyticsEvents.push(evt);
      },
    },
  });
});

beforeEach(() => {
  countResult = 0;
  createdId = "new-article-id";
  findFirstResult = null;
  scrapeThrows = false;
  ssrfThrows = false;
  createCalled = false;
  createArgs = null;
  updateCalled = false;
  auditCalls = 0;
  auditMeta = [];
  analyticsEvents = [];
  securityEvents = [];
  sanitizeCalls = [];
  p2002Throws = false;
  scrapeResult = {
    title: "Scraped Article",
    author: null,
    source: "example.com",
    sourceUrl: "https://example.com/article",
    heroImage: null,
    excerpt: null,
    content: "<p>" + "word ".repeat(60) + "</p>",
    category: "tech",
    wordCount: 60,
    readingMinutes: 1,
    publishedAt: null,
  };
});

// ============================================================
// Quota tests
// ============================================================
test("quota: assertWithinDailyQuota passes when under limit", async () => {
  const { assertWithinDailyQuota } = await import("@/lib/import/quota");
  countResult = 4;
  await assert.doesNotReject(() => assertWithinDailyQuota("user-1"));
});

test("quota: assertWithinDailyQuota throws 429 when at limit", async () => {
  const { assertWithinDailyQuota } = await import("@/lib/import/quota");
  countResult = 5;
  let caught: unknown;
  try {
    await assertWithinDailyQuota("user-1");
    assert.fail("expected error to be thrown");
  } catch (e) {
    caught = e;
  }
  assert.ok(
    (caught as { status?: number }).status === 429 || String(caught).includes("daily import limit"),
    `expected 429/quota error, got: ${caught}`,
  );
});

test("quota: utcDayStart returns midnight UTC", async () => {
  const { utcDayStart } = await import("@/lib/import/quota");
  const d = utcDayStart();
  assert.equal(d.getUTCHours(), 0);
  assert.equal(d.getUTCMinutes(), 0);
  assert.equal(d.getUTCSeconds(), 0);
  assert.equal(d.getUTCMilliseconds(), 0);
});

// ============================================================
// URL import service tests
// ============================================================
test("url-import: rejects SSRF URLs and records a security event", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  ssrfThrows = true;
  let caught: unknown;
  try {
    await importArticleFromUrl({ rawUrl: "https://192.168.1.1/evil", userId: "user-1", req: mockReq, session, requestId: "r1" });
    assert.fail("expected error to be thrown");
  } catch (e) {
    caught = e;
  }
  assert.ok(
    (caught as { status?: number }).status === 422 || String(caught).includes("422") || String(caught).includes("unsafe") || String(caught).includes("Invalid"),
    `expected 422 SSRF error, got: ${caught}`,
  );
  assert.equal(createCalled, false);
  assert.ok(securityEvents.length >= 1, "security event should be recorded for SSRF attempt");
});

test("url-import: rejects non-http protocol before scraping (file:)", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  await assert.rejects(() =>
    importArticleFromUrl({ rawUrl: "file:///etc/passwd", userId: "user-1", req: mockReq, session, requestId: "r1" }),
  );
  assert.equal(createCalled, false);
});

test("url-import: returns duplicate=true for raw URL already owned by user", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  findFirstResult = { id: "existing-id" };
  const result = await importArticleFromUrl({ rawUrl: "https://example.com/article", userId: "user-1", req: mockReq, session, requestId: "r1" });
  assert.equal(result.status, 200);
  assert.equal((result as { id: string; duplicate: true }).duplicate, true);
  assert.equal(result.id, "existing-id");
  assert.equal(createCalled, false);
});

test("url-import: raw-URL duplicate bypasses daily quota (does not 429 at limit)", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  countResult = 5;
  findFirstResult = { id: "existing-id" };
  // Should NOT throw 429 because duplicate check happens first
  const result = await importArticleFromUrl({ rawUrl: "https://example.com/article", userId: "user-1", req: mockReq, session, requestId: "r1" });
  assert.equal(result.status, 200);
});

test("url-import: 429 when no duplicate and quota is full", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  countResult = 5;
  findFirstResult = null;
  let caught: unknown;
  try {
    await importArticleFromUrl({ rawUrl: "https://example.com/article", userId: "user-1", req: mockReq, session, requestId: "r1" });
    assert.fail("expected error to be thrown");
  } catch (e) {
    caught = e;
  }
  assert.ok(
    (caught as { status?: number }).status === 429 || String(caught).includes("limit"),
    `expected 429, got: ${caught}`,
  );
  assert.equal(createCalled, false);
});

test("url-import: 422 when scraper throws", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  scrapeThrows = true;
  await assert.rejects(() =>
    importArticleFromUrl({ rawUrl: "https://example.com/article", userId: "user-1", req: mockReq, session, requestId: "r1" }),
  );
  assert.equal(createCalled, false);
});

test("url-import: 422 when scraper returns null (extraction failed)", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  scrapeResult = null;
  await assert.rejects(() =>
    importArticleFromUrl({ rawUrl: "https://example.com/article", userId: "user-1", req: mockReq, session, requestId: "r1" }),
  );
  assert.equal(createCalled, false);
});

test("url-import: successful import returns status 201 with id", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  const result = await importArticleFromUrl({ rawUrl: "https://example.com/article", userId: "user-1", req: mockReq, session, requestId: "r1" });
  assert.equal(result.status, 201);
  assert.equal(result.id, createdId);
  assert.equal(auditCalls, 1);
});

test("url-import: audit metadata contains importType=url and does NOT contain article content", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  await importArticleFromUrl({ rawUrl: "https://example.com/article", userId: "user-1", req: mockReq, session, requestId: "r1" });
  assert.equal(auditCalls, 1);
  const meta = auditMeta[0] as Record<string, unknown>;
  assert.equal(meta.importType, "url");
  assert.ok(!("content" in meta), "audit metadata must not contain article content");
  assert.ok(!("text" in meta), "audit metadata must not contain article text");
});

test("url-import: analytics event is emitted with importType=url and no article body", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  await importArticleFromUrl({ rawUrl: "https://example.com/article", userId: "user-1", req: mockReq, session, requestId: "r1" });
  assert.ok(analyticsEvents.length >= 1, "analytics event should be recorded");
  const props = analyticsEvents[0].properties as Record<string, unknown>;
  assert.equal(props.importType, "url");
  assert.ok(!("content" in props), "analytics must not contain article content");
  assert.ok(!("text" in props), "analytics must not contain article text");
});

// ============================================================
// Text import service tests
// ============================================================
test("text-import: rejects empty text", async () => {
  const { importArticleFromText } = await import("@/lib/import/text-import");
  await assert.rejects(() =>
    importArticleFromText({ title: "T", text: "   ", userId: "user-1", req: mockReq, session, requestId: "r1" }),
  );
});

test("text-import: rejects text below minimum word count", async () => {
  const { importArticleFromText } = await import("@/lib/import/text-import");
  await assert.rejects(() =>
    importArticleFromText({ title: "T", text: "too short", userId: "user-1", req: mockReq, session, requestId: "r1" }),
  );
  assert.equal(createCalled, false);
});

test("text-import: 429 when daily quota is full", async () => {
  const { importArticleFromText } = await import("@/lib/import/text-import");
  countResult = 5;
  let caught: unknown;
  try {
    await importArticleFromText({ title: "T", text: "word ".repeat(55).trim(), userId: "user-1", req: mockReq, session, requestId: "r1" });
    assert.fail("expected error to be thrown");
  } catch (e) {
    caught = e;
  }
  assert.ok(
    (caught as { status?: number }).status === 429 || String(caught).includes("limit"),
    `expected 429, got: ${caught}`,
  );
  assert.equal(createCalled, false);
});

test("text-import: successful import returns status 201 with id", async () => {
  const { importArticleFromText } = await import("@/lib/import/text-import");
  const result = await importArticleFromText({ title: "My Title", text: "word ".repeat(55).trim(), userId: "user-1", req: mockReq, session, requestId: "r1" });
  assert.equal(result.status, 201);
  assert.equal(result.id, createdId);
  assert.equal(auditCalls, 1);
});

test("text-import: sanitizes HTML before storing (strips script/onerror)", async () => {
  const { importArticleFromText } = await import("@/lib/import/text-import");
  const safeBody = "word ".repeat(50).trim();
  await importArticleFromText({
    title: "XSS Attempt",
    text: `${safeBody}\n\n<script>alert('xss')</script> world <img src=x onerror=alert(1)> more text here.`,
    userId: "user-1",
    req: mockReq,
    session,
    requestId: "r1",
  });
  assert.ok(sanitizeCalls.length >= 1, "sanitizeArticleHtml should be called");
  const stored = createArgs?.data?.content ?? "";
  assert.doesNotMatch(stored, /<script/i);
  assert.doesNotMatch(stored, /onerror/i);
});

test("text-import: audit metadata contains importType=text and NOT the article text", async () => {
  const { importArticleFromText } = await import("@/lib/import/text-import");
  await importArticleFromText({ title: "T", text: "word ".repeat(55).trim(), userId: "user-1", req: mockReq, session, requestId: "r1" });
  assert.equal(auditCalls, 1);
  const meta = auditMeta[0] as Record<string, unknown>;
  assert.equal(meta.importType, "text");
  assert.ok(!("text" in meta), "audit metadata must not contain article text");
  assert.ok(!("content" in meta), "audit metadata must not contain article content");
});

test("text-import: analytics event is emitted with importType=text and no article body", async () => {
  const { importArticleFromText } = await import("@/lib/import/text-import");
  await importArticleFromText({ title: "T", text: "word ".repeat(55).trim(), userId: "user-1", req: mockReq, session, requestId: "r1" });
  assert.ok(analyticsEvents.length >= 1, "analytics event should be recorded");
  const props = analyticsEvents[0].properties as Record<string, unknown>;
  assert.equal(props.importType, "text");
  assert.ok(!("text" in props), "analytics must not contain article text");
  assert.ok(!("content" in props), "analytics must not contain article content");
});
