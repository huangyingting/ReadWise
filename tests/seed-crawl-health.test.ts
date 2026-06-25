import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import type { CrawlRunOutcome } from "@/lib/content-sources";
import type { ArticleProcessResult } from "@/lib/processing/processor";

process.env.LOG_LEVEL = "error";

before(() => {
  // The seeder pulls in processor/scraper modules at import time; those touch
  // prisma + AI. We inject ALL runtime deps below, so the real implementations
  // never execute — these mocks only satisfy the import graph (DB/network-free).
  mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
  mock.module("@/lib/ai", {
    namedExports: {
      isAiConfigured: () => false,
      aiModelName: () => null,
      chatComplete: async () => null,
    },
  });
});

const okResult = (articleId: string): ArticleProcessResult => ({
  articleId,
  title: "t",
  published: true,
  steps: [],
  ok: true,
});

test("runSeed records a crawl-health outcome per provider (RW-050)", async () => {
  const { runSeed } = await import("@/lib/seed");
  const recordCrawl: Array<{ key: string; outcome: CrawlRunOutcome }> = [];

  const stats = await runSeed({
    providerKeys: ["nbc"],
    deps: {
      discover: async () => ["https://nbc.example/a", "https://nbc.example/b"],
      scrapeAndSave: async (url: string) => ({
        status: "saved",
        id: url,
        article: { title: "x" } as never,
      }),
      resolveArticleId: async () => null,
      process: async (id: string) => okResult(id),
      recordCrawl: async (key, outcome) => {
        recordCrawl.push({ key, outcome });
      },
    },
  });

  assert.equal(recordCrawl.length, 1);
  assert.equal(recordCrawl[0].key, "nbc");
  assert.equal(recordCrawl[0].outcome.discovered, 2);
  assert.equal(recordCrawl[0].outcome.scraped, 2);
  assert.equal(recordCrawl[0].outcome.failed, 0);
  assert.equal(recordCrawl[0].outcome.error, null);
  assert.equal(stats.discovered, 2);
  assert.equal(stats.saved, 2);
});

test("runSeed reports a discovery error in the crawl outcome", async () => {
  const { runSeed } = await import("@/lib/seed");
  const recordCrawl: Array<{ key: string; outcome: CrawlRunOutcome }> = [];

  await runSeed({
    providerKeys: ["nbc"],
    deps: {
      discover: async () => {
        throw new Error("discovery blew up");
      },
      scrapeAndSave: async () => ({ status: "failed", reason: "n/a", sourceUrl: "x" }),
      resolveArticleId: async () => null,
      process: async (id: string) => okResult(id),
      recordCrawl: async (key, outcome) => {
        recordCrawl.push({ key, outcome });
      },
    },
  });

  assert.equal(recordCrawl.length, 1);
  assert.equal(recordCrawl[0].outcome.discovered, 0);
  assert.match(String(recordCrawl[0].outcome.error), /discovery blew up/);
});
