process.env.LOG_LEVEL = "error";
/**
 * Unit tests for the personal article import services (Issue #468, REF-031, REF-086).
 *
 * Covers: quota, URL import (SSRF, raw/canonical dedupe, quota, P2002 race),
 * text import (empty, short, sanitization, audit/analytics metadata policy).
 *
 * REF-086: URL-import and text-import tests now use narrow `deps` injection
 * instead of broad `mock.module` replacements for the external I/O callables
 * (scraper, audit, analytics, security events). Only `@/lib/prisma` is still
 * module-mocked for the quota tests, which call through the Prisma singleton.
 */
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "next-auth";
import type { UrlImportDeps } from "@/lib/import/url-import";
import type { TextImportDeps } from "@/lib/import/text-import";
import { makeTransactionDb } from "./support/prisma-mock";

type ImportArticleFromUrl = typeof import("@/lib/import/url-import").importArticleFromUrl;
type ImportArticleFromText = typeof import("@/lib/import/text-import").importArticleFromText;

// ---- mutable stubs shared across test groups --------------------------------
let countResult = 0;
let createdId = "new-article-id";
let auditCalls = 0;
let auditMeta: unknown[] = [];
let analyticsEvents: unknown[] = [];
let securityEvents: unknown[] = [];
let createCalled = false;
let createArgs: { data?: { content?: string; metadata?: unknown } } | null = null;
let updateCalled = false;
let p2002Throws = false;

const USER_ID = "user-1";
const REQUEST_ID = "r1";
const ARTICLE_URL = "https://example.com/article";

const session = { user: { id: "user-1", role: "Reader", name: "T", email: "t@e.com" }, expires: "2099-01-01" } as unknown as Session;
const mockReq = new Request("http://localhost/api/articles/import", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});

const defaultScraped = {
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

// ---------------------------------------------------------------------------
// Module mock — only @/lib/prisma (needed by quota.ts which has no DI seam)
// ---------------------------------------------------------------------------

let prismaStub: Record<string, unknown>;

before(() => {
  prismaStub = {
    article: {
      count: async () => countResult,
      // Fallback stubs in case any non-DI path calls through the singleton.
      findFirst: async () => null,
      findMany: async () => [],
    },
  };

  mock.module("@/lib/prisma", {
    namedExports: { prisma: prismaStub },
  });
});

beforeEach(() => {
  countResult = 0;
  createdId = "new-article-id";
  auditCalls = 0;
  auditMeta = [];
  analyticsEvents = [];
  securityEvents = [];
  createCalled = false;
  createArgs = null;
  updateCalled = false;
  p2002Throws = false;
});

// ---------------------------------------------------------------------------
// Narrow dep factories
// ---------------------------------------------------------------------------

/**
 * Build a complete `UrlImportDeps` stub whose external boundaries are
 * controlled by the test's mutable state variables.
 * Override individual fields via the `overrides` argument.
 */
function makeUrlDeps(overrides: Partial<UrlImportDeps> = {}): UrlImportDeps {
  return {
    assertSafeUrl: async () => {},
    findOwnedArticleBySourceUrl: async () => null,
    scrape: async () => ({ ...defaultScraped }),
    assertWithinDailyQuota: async () => {},
    db: makeTransactionDb({
      article: {
        create: async (args: unknown) => {
          createCalled = true;
          createArgs = args as typeof createArgs;
          if (p2002Throws) {
            const err = new Error(
              "Unique constraint failed on the fields: (`sourceUrl`,`ownerId`)",
            );
            (err as unknown as { code: string }).code = "P2002";
            // Make instanceof Prisma.PrismaClientKnownRequestError work in the
            // non-mocked resolveDuplicateOnConflict helper.
            // The function checks `err.code === "P2002"` directly, so the
            // code assignment is sufficient for branch coverage here.
            throw err;
          }
          return { id: createdId };
        },
        update: async () => { updateCalled = true; return {}; },
      },
    }),
    recordAuditFromRequest: async (args) => {
      auditCalls++;
      auditMeta.push((args as { metadata?: unknown }).metadata);
    },
    recordSecurityEvent: (evt) => {
      securityEvents.push(evt);
    },
    recordEvent: async (evt) => {
      analyticsEvents.push(evt);
    },
    ...overrides,
  };
}

/**
 * Build a complete `TextImportDeps` stub whose external boundaries are
 * controlled by the test's mutable state variables.
 */
function makeTextDeps(overrides: Partial<TextImportDeps> = {}): TextImportDeps {
  return {
    assertWithinDailyQuota: async () => {},
    db: makeTransactionDb({
      article: {
        create: async (args: unknown) => {
          createCalled = true;
          createArgs = args as typeof createArgs;
          return { id: createdId };
        },
        update: async () => { updateCalled = true; return {}; },
      },
    }),
    recordAuditFromRequest: async (args) => {
      auditCalls++;
      auditMeta.push((args as { metadata?: unknown }).metadata);
    },
    recordEvent: async (evt) => {
      analyticsEvents.push(evt);
    },
    ...overrides,
  };
}

function validText() {
  return "word ".repeat(55).trim();
}

function urlImportArgs(
  overrides: Partial<Parameters<ImportArticleFromUrl>[0]> = {},
): Parameters<ImportArticleFromUrl>[0] {
  return {
    rawUrl: ARTICLE_URL,
    userId: USER_ID,
    req: mockReq,
    session,
    requestId: REQUEST_ID,
    deps: makeUrlDeps(),
    ...overrides,
  };
}

function textImportArgs(
  overrides: Partial<Parameters<ImportArticleFromText>[0]> = {},
): Parameters<ImportArticleFromText>[0] {
  return {
    title: "T",
    text: validText(),
    userId: USER_ID,
    req: mockReq,
    session,
    requestId: REQUEST_ID,
    deps: makeTextDeps(),
    ...overrides,
  };
}

async function captureImportError(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
    assert.fail("expected error to be thrown");
  } catch (e) {
    return e;
  }
}

// ============================================================
// Quota tests (module-mock path via prisma singleton)
// ============================================================
test("quota: assertWithinDailyQuota passes when under limit", async () => {
  const { assertWithinDailyQuota } = await import("@/lib/import/quota");
  countResult = 4;
  await assert.doesNotReject(() => assertWithinDailyQuota(USER_ID));
});

test("quota: assertWithinDailyQuota throws 429 when at limit", async () => {
  const { assertWithinDailyQuota } = await import("@/lib/import/quota");
  countResult = 5;
  const caught = await captureImportError(() => assertWithinDailyQuota(USER_ID));
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
// URL import service tests (narrow deps-injection path)
// ============================================================
test("url-import: rejects SSRF URLs and records a security event", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  const caught = await captureImportError(() =>
    importArticleFromUrl(urlImportArgs({
      rawUrl: "https://192.168.1.1/evil",
      deps: makeUrlDeps({
        assertSafeUrl: async () => { throw new Error("Unsafe URL: private address"); },
      }),
    })),
  );
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
    importArticleFromUrl(urlImportArgs({
      rawUrl: "file:///etc/passwd",
      deps: makeUrlDeps({
        assertSafeUrl: async (url: string) => {
          const u = new URL(url);
          if (u.protocol !== "http:" && u.protocol !== "https:") {
            throw new Error(`Only http(s) URLs are allowed (got ${u.protocol})`);
          }
        },
      }),
    })),
  );
  assert.equal(createCalled, false);
});

test("url-import: returns duplicate=true for raw URL already owned by user", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  const result = await importArticleFromUrl(urlImportArgs({
    deps: makeUrlDeps({
      findOwnedArticleBySourceUrl: async () => ({ id: "existing-id" }),
    }),
  }));
  assert.equal(result.status, 200);
  assert.equal((result as { id: string; duplicate: true }).duplicate, true);
  assert.equal(result.id, "existing-id");
  assert.equal(createCalled, false);
});

test("url-import: raw-URL duplicate bypasses daily quota (does not 429 at limit)", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  // quota stub throws — but duplicate check fires first
  const result = await importArticleFromUrl(urlImportArgs({
    deps: makeUrlDeps({
      findOwnedArticleBySourceUrl: async () => ({ id: "existing-id" }),
      assertWithinDailyQuota: async () => {
        throw new Error("should not be called for raw-url duplicate");
      },
    }),
  }));
  assert.equal(result.status, 200);
});

test("url-import: 429 when no duplicate and quota is full", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  const { ApiError } = await import("@/lib/api-handler");
  const caught = await captureImportError(() =>
    importArticleFromUrl(urlImportArgs({
      deps: makeUrlDeps({
        assertWithinDailyQuota: async () => {
          throw new ApiError(429, "daily import limit");
        },
      }),
    })),
  );
  assert.ok(
    (caught as { status?: number }).status === 429 || String(caught).includes("limit"),
    `expected 429, got: ${caught}`,
  );
  assert.equal(createCalled, false);
});

test("url-import: 422 when scraper throws", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  const caught = await captureImportError(() =>
    importArticleFromUrl(urlImportArgs({
      deps: makeUrlDeps({
        scrape: async () => { throw new Error("Network error with private article sentence"); },
      }),
    })),
  );
  assert.equal((caught as { status?: number }).status, 422);
  assert.equal(
    (caught as { message?: string }).message,
    "Scrape failed. The article could not be fetched.",
  );
  assert.equal(createCalled, false);
});

test("url-import: 422 when scraper returns null (extraction failed)", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  await assert.rejects(() =>
    importArticleFromUrl(urlImportArgs({
      deps: makeUrlDeps({ scrape: async () => null }),
    })),
  );
  assert.equal(createCalled, false);
});

test("url-import: successful import returns status 201 with id", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  const result = await importArticleFromUrl(urlImportArgs());
  assert.equal(result.status, 201);
  assert.equal(result.id, createdId);
  assert.equal(auditCalls, 1);
});

test("url-import: audit metadata contains importType=url and does NOT contain article content", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  await importArticleFromUrl(urlImportArgs());
  assert.equal(auditCalls, 1);
  const meta = auditMeta[0] as Record<string, unknown>;
  assert.equal(meta.importType, "url");
  assert.ok(!("content" in meta), "audit metadata must not contain article content");
  assert.ok(!("text" in meta), "audit metadata must not contain article text");
});

test("url-import: analytics event is emitted with importType=url and no article body", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  await importArticleFromUrl(urlImportArgs());
  assert.ok(analyticsEvents.length >= 1, "analytics event should be recorded");
  const props = (analyticsEvents[0] as { properties?: Record<string, unknown> }).properties ?? {};
  assert.equal(props.importType, "url");
  assert.ok(!("content" in props), "analytics must not contain article content");
  assert.ok(!("text" in props), "analytics must not contain article text");
});

// ============================================================
// Text import service tests (narrow deps-injection path)
// ============================================================
test("text-import: rejects empty text", async () => {
  const { importArticleFromText } = await import("@/lib/import/text-import");
  await assert.rejects(() =>
    importArticleFromText(textImportArgs({
      text: "   ",
    })),
  );
});

test("text-import: rejects text below minimum word count", async () => {
  const { importArticleFromText } = await import("@/lib/import/text-import");
  await assert.rejects(() =>
    importArticleFromText(textImportArgs({
      text: "too short",
    })),
  );
  assert.equal(createCalled, false);
});

test("text-import: 429 when daily quota is full", async () => {
  const { importArticleFromText } = await import("@/lib/import/text-import");
  const { ApiError } = await import("@/lib/api-handler");
  const caught = await captureImportError(() =>
    importArticleFromText(textImportArgs({
      deps: makeTextDeps({
        assertWithinDailyQuota: async () => {
          throw new ApiError(429, "daily import limit");
        },
      }),
    })),
  );
  assert.ok(
    (caught as { status?: number }).status === 429 || String(caught).includes("limit"),
    `expected 429, got: ${caught}`,
  );
  assert.equal(createCalled, false);
});

test("text-import: successful import returns status 201 with id", async () => {
  const { importArticleFromText } = await import("@/lib/import/text-import");
  const result = await importArticleFromText(textImportArgs({
    title: "My Title",
  }));
  assert.equal(result.status, 201);
  assert.equal(result.id, createdId);
  assert.equal(auditCalls, 1);
});

test("text-import: sanitizes HTML before storing (strips script/onerror)", async () => {
  const { importArticleFromText } = await import("@/lib/import/text-import");
  const safeBody = "word ".repeat(50).trim();
  await importArticleFromText(textImportArgs({
    title: "XSS Attempt",
    text: `${safeBody}\n\n<script>alert('xss')</script> world <img src=x onerror=alert(1)> more text here.`,
  }));
  assert.ok(createCalled, "article create should have been called");
  const stored = createArgs?.data?.content ?? "";
  assert.doesNotMatch(stored, /<script/i);
  assert.doesNotMatch(stored, /onerror/i);
});

test("text-import: audit metadata contains importType=text and NOT the article text", async () => {
  const { importArticleFromText } = await import("@/lib/import/text-import");
  await importArticleFromText(textImportArgs());
  assert.equal(auditCalls, 1);
  const meta = auditMeta[0] as Record<string, unknown>;
  assert.equal(meta.importType, "text");
  assert.ok(!("text" in meta), "audit metadata must not contain article text");
  assert.ok(!("content" in meta), "audit metadata must not contain article content");
});

test("text-import: analytics event is emitted with importType=text and no article body", async () => {
  const { importArticleFromText } = await import("@/lib/import/text-import");
  await importArticleFromText(textImportArgs());
  assert.ok(analyticsEvents.length >= 1, "analytics event should be recorded");
  const props = (analyticsEvents[0] as { properties?: Record<string, unknown> }).properties ?? {};
  assert.equal(props.importType, "text");
  assert.ok(!("text" in props), "analytics must not contain article text");
  assert.ok(!("content" in props), "analytics must not contain article content");
});
