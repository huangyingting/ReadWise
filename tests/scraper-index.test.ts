/**
 * Unit tests for src/lib/scraper/index.ts (scrapeUrl, saveDraftArticle, scrapeAndSave).
 *
 * All network, DB, and heavy module deps are mocked — no real I/O is performed.
 * Mutable stub state is reset in beforeEach so each test starts clean.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import type { ScrapedArticle } from "@/lib/scraper/types";
import type { AuditRequestInput } from "@/lib/security/audit";

// ── Mutable stub state (reset in beforeEach) ─────────────────────────────────

let scraperEnabled = true;
let fetchHtmlResult = "<html><body>mock-html</body></html>";
let extractArticleResult: ScrapedArticle | null = null;
let existingArticle: { id: string } | null = null;
let qualityGrade: "ok" | "warn" | "reject" = "ok";
let qualityScore = 90;

// Function stub for tx.article.create; reassigned per test.
let txCreateStub: () => Promise<{ id: string }> = async () => ({ id: "new-article-id" });

// Captured audit inputs from the mocked recordAuditFromRequest.
let recordedAuditInputs: unknown[] = [];

const BASE_ARTICLE: ScrapedArticle = {
  title: "The Philosophy of Networks",
  author: "Ada Lovelace",
  source: "Noema Magazine",
  sourceUrl: "https://www.noemamag.com/the-philosophy-of-networks",
  heroImage: "https://cdn.noemamag.com/hero.jpg",
  excerpt: "A deep dive into networked thinking.",
  content: `<p>${"Networks shape our world in profound ways and connect communities through shared institutions. ".repeat(125)}</p>`,
  category: "culture",
  publishedAt: new Date("2026-03-01T09:00:00Z"),
  wordCount: 1000,
  readingMinutes: 5,
};

// ── Module mocks (registered before the module under test is first loaded) ───

before(() => {
  mock.module("@/lib/runtime-config/feature-flags", {
    namedExports: {
      isScraperFeatureEnabled: () => scraperEnabled,
      isAiFeatureEnabled: () => false,
      isTtsFeatureEnabled: () => false,
      isPushFeatureEnabled: () => false,
      isTodaySessionFeatureEnabled: () => false,
      isFeatureEnabled: () => false,
    },
  });

  mock.module("@/lib/scraper/fetch", {
    namedExports: {
      fetchHtml: async (_url: string) => fetchHtmlResult,
      fetchText: async (_url: string) => fetchHtmlResult,
    },
  });

  mock.module("@/lib/scraper/extract", {
    namedExports: {
      extractArticle: (_html: string, _url: string) => extractArticleResult,
      decodeEntities: (s: string) => s,
      stripTags: (s: string) => s,
      metaContent: () => null,
      extractArticleJsonLd: () => null,
    },
  });

  mock.module("@/lib/scraper/quality", {
    namedExports: {
      checkContentQuality: (_article: unknown) => ({
        grade: qualityGrade,
        score: qualityScore,
        signals: [],
      }),
      MIN_WORD_COUNT: 50,
      SHORT_WORD_COUNT: 150,
      MIN_READING_MINUTES: 5,
      MIN_READING_WORD_COUNT: 1000,
      MAX_LINK_DENSITY: 0.5,
      MAX_GARBAGE_RATIO: 0.02,
      BOILERPLATE_HIT_THRESHOLD: 3,
    },
  });

  mock.module("@/lib/article-library", {
    namedExports: {
      findPublicLibraryArticleBySourceUrl: async (_url: string) => existingArticle,
      PUBLIC_ARTICLE_CREATE_FIELDS: {},
      publicListableArticleWhere: () => ({}),
      toListingArticle: (a: unknown) => a,
      canReadArticle: () => false,
    },
  });

  mock.module("@/lib/security/audit", {
    namedExports: {
      recordAuditFromRequest: async (input: unknown) => {
        recordedAuditInputs.push(input);
      },
      AUDIT_ACTIONS: {},
      sanitizeAuditMetadata: (m: unknown) => m,
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            article: { create: () => txCreateStub() },
            auditLog: { create: async () => {} },
          }),
      },
    },
  });

  // Stub the sources re-export barrel so index.ts loads without DB/metrics side-effects.
  mock.module("@/lib/scraper/sources", {
    namedExports: {
      HEALTH_THRESHOLDS: { degraded: 0.8, failing: 0.5 },
      computeHealthStatus: () => "healthy",
      applyCrawlOutcome: () => {},
      summarizeSourceHealth: () => ({}),
      syncContentSources: async () => ({ synced: 0, removed: 0 }),
      listContentSources: async () => [],
      getContentSource: async () => null,
      isProviderEnabled: async () => true,
      setContentSourceEnabled: async () => {},
      recordCrawlRun: async () => {},
    },
  });
});

beforeEach(() => {
  scraperEnabled = true;
  fetchHtmlResult = "<html><body>mock-html</body></html>";
  extractArticleResult = { ...BASE_ARTICLE };
  existingArticle = null;
  qualityGrade = "ok";
  qualityScore = 90;
  txCreateStub = async () => ({ id: "new-article-id" });
  recordedAuditInputs = [];
});

// ── scrapeUrl ────────────────────────────────────────────────────────────────

test("scrapeUrl returns null when the scraper feature flag is disabled", async () => {
  scraperEnabled = false;
  const { scrapeUrl } = await import("@/lib/scraper");
  const result = await scrapeUrl("https://www.noemamag.com/philosophy");
  assert.equal(result, null);
});

test("scrapeUrl returns null when extractArticle cannot parse the HTML", async () => {
  extractArticleResult = null;
  const { scrapeUrl } = await import("@/lib/scraper");
  const result = await scrapeUrl("https://www.noemamag.com/philosophy");
  assert.equal(result, null);
});

test("scrapeUrl returns a populated ScrapedArticle on success", async () => {
  extractArticleResult = { ...BASE_ARTICLE };
  const { scrapeUrl } = await import("@/lib/scraper");
  const result = await scrapeUrl("https://www.noemamag.com/the-philosophy-of-networks");
  assert.ok(result, "expected a ScrapedArticle, got null");
  assert.equal(result!.title, BASE_ARTICLE.title);
  assert.equal(result!.sourceUrl, BASE_ARTICLE.sourceUrl);
  assert.equal(result!.wordCount, BASE_ARTICLE.wordCount);
  assert.equal(result!.category, BASE_ARTICLE.category);
});

// ── saveDraftArticle ─────────────────────────────────────────────────────────

test("saveDraftArticle returns skipped when sourceUrl already exists in the public library", async () => {
  existingArticle = { id: "existing-1" };
  const { saveDraftArticle } = await import("@/lib/scraper");
  const outcome = await saveDraftArticle({ ...BASE_ARTICLE });
  assert.equal(outcome.status, "skipped");
  if (outcome.status === "skipped") {
    assert.equal(outcome.reason, "duplicate sourceUrl");
    assert.equal(outcome.sourceUrl, BASE_ARTICLE.sourceUrl);
  }
});

test("saveDraftArticle persists the article and returns saved with the new id", async () => {
  txCreateStub = async () => ({ id: "created-999" });
  const { saveDraftArticle } = await import("@/lib/scraper");
  const outcome = await saveDraftArticle({ ...BASE_ARTICLE });
  assert.equal(outcome.status, "saved");
  if (outcome.status === "saved") {
    assert.equal(outcome.id, "created-999");
    assert.deepEqual(outcome.article, BASE_ARTICLE);
  }
});

test("saveDraftArticle calls the audit callback with the created row id", async () => {
  txCreateStub = async () => ({ id: "audit-target-id" });
  const capturedIds: string[] = [];
  const { saveDraftArticle } = await import("@/lib/scraper");
  const audit = (created: { id: string }): AuditRequestInput => {
    capturedIds.push(created.id);
    return { action: "article.scrape", targetType: "article" } as unknown as AuditRequestInput;
  };
  await saveDraftArticle({ ...BASE_ARTICLE }, audit);
  assert.equal(capturedIds.length, 1);
  assert.equal(capturedIds[0], "audit-target-id");
  // recordAuditFromRequest should also have been called once.
  assert.equal(recordedAuditInputs.length, 1);
});

test("saveDraftArticle returns skipped when a P2002 unique-constraint error is thrown inside the transaction", async () => {
  txCreateStub = async () => {
    throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed on `sourceUrl`", {
      code: "P2002",
      clientVersion: "5.0.0",
    });
  };
  const { saveDraftArticle } = await import("@/lib/scraper");
  const outcome = await saveDraftArticle({ ...BASE_ARTICLE });
  assert.equal(outcome.status, "skipped");
  if (outcome.status === "skipped") {
    assert.equal(outcome.reason, "duplicate sourceUrl");
  }
});

test("saveDraftArticle rethrows non-unique-constraint database errors", async () => {
  txCreateStub = async () => {
    throw new Error("connection pool exhausted");
  };
  const { saveDraftArticle } = await import("@/lib/scraper");
  await assert.rejects(
    () => saveDraftArticle({ ...BASE_ARTICLE }),
    /connection pool exhausted/,
  );
});

// ── scrapeAndSave ────────────────────────────────────────────────────────────

test("scrapeAndSave returns failed when the scraper feature flag is disabled", async () => {
  scraperEnabled = false;
  const { scrapeAndSave } = await import("@/lib/scraper");
  const outcome = await scrapeAndSave("https://www.noemamag.com/some-article");
  assert.equal(outcome.status, "failed");
  if (outcome.status === "failed") {
    assert.match(outcome.reason, /disabled/);
    assert.equal(outcome.sourceUrl, "https://www.noemamag.com/some-article");
  }
});

test("scrapeAndSave returns failed when scrapeUrl cannot extract article content", async () => {
  extractArticleResult = null;
  const { scrapeAndSave } = await import("@/lib/scraper");
  const outcome = await scrapeAndSave("https://www.noemamag.com/article");
  assert.equal(outcome.status, "failed");
  if (outcome.status === "failed") {
    assert.match(outcome.reason, /extract/);
  }
});

test("scrapeAndSave returns failed when content quality grade is reject", async () => {
  qualityGrade = "reject";
  qualityScore = 15;
  const { scrapeAndSave } = await import("@/lib/scraper");
  const outcome = await scrapeAndSave("https://www.noemamag.com/article");
  assert.equal(outcome.status, "failed");
  if (outcome.status === "failed") {
    assert.match(outcome.reason, /quality/);
    assert.match(outcome.reason, /score=15/);
  }
});

test("scrapeAndSave persists and returns saved outcome when quality is ok", async () => {
  qualityGrade = "ok";
  txCreateStub = async () => ({ id: "persisted-id" });
  const { scrapeAndSave } = await import("@/lib/scraper");
  const outcome = await scrapeAndSave("https://www.noemamag.com/the-philosophy-of-networks");
  assert.equal(outcome.status, "saved");
  if (outcome.status === "saved") {
    assert.equal(outcome.id, "persisted-id");
  }
});

test("scrapeAndSave saves the article even when quality grade is warn (non-breaking advisory signal)", async () => {
  qualityGrade = "warn";
  qualityScore = 55;
  txCreateStub = async () => ({ id: "warn-persisted" });
  const { scrapeAndSave } = await import("@/lib/scraper");
  const outcome = await scrapeAndSave("https://www.noemamag.com/some-article");
  assert.equal(outcome.status, "saved");
});

test("scrapeAndSave captures unexpected thrown errors as a failed outcome", async () => {
  txCreateStub = async () => {
    throw new Error("unexpected db failure");
  };
  const { scrapeAndSave } = await import("@/lib/scraper");
  const outcome = await scrapeAndSave("https://www.noemamag.com/article");
  assert.equal(outcome.status, "failed");
  if (outcome.status === "failed") {
    assert.match(outcome.reason, /unexpected db failure/);
  }
});

test("scrapeAndSave returns skipped outcome when duplicate sourceUrl is found during save", async () => {
  existingArticle = { id: "dup-existing" };
  const { scrapeAndSave } = await import("@/lib/scraper");
  const outcome = await scrapeAndSave("https://www.noemamag.com/the-philosophy-of-networks");
  assert.equal(outcome.status, "skipped");
});

test("scrapeAndSave captures non-Error thrown values as a failed outcome using String()", async () => {
  // Exercises errorMessage's String(err) branch (line 112 of index.ts).
  txCreateStub = async (): Promise<{ id: string }> => {
    throw "plain string error"; // intentionally a non-Error to cover String(err) branch
  };
  const { scrapeAndSave } = await import("@/lib/scraper");
  const outcome = await scrapeAndSave("https://www.noemamag.com/article");
  assert.equal(outcome.status, "failed");
  if (outcome.status === "failed") {
    assert.equal(outcome.reason, "plain string error");
  }
});
