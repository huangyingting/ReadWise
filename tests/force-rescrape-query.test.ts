/** Metadata-only query and DTO coverage for force-rescrape status. */
process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

import { ArticleContentVersionStatus } from "@prisma/client";

let articleExists = true;
let annotationCount = 0;
let uniqueRows: Array<Record<string, unknown> | null> = [];
let historyRows: Array<Record<string, unknown>> = [];
const articleCalls: unknown[] = [];
const annotationCalls: unknown[] = [];
const uniqueCalls: unknown[] = [];
const historyCalls: unknown[] = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findUnique: async (args: unknown) => {
            articleCalls.push(args);
            return articleExists ? { id: "article-query" } : null;
          },
        },
        highlight: {
          count: async (args: unknown) => {
            annotationCalls.push(args);
            return annotationCount;
          },
        },
        articleContentVersion: {
          findUnique: async (args: unknown) => {
            uniqueCalls.push(args);
            return uniqueRows.shift() ?? null;
          },
          findMany: async (args: unknown) => {
            historyCalls.push(args);
            return historyRows;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  articleExists = true;
  annotationCount = 0;
  uniqueRows = [];
  historyRows = [];
  articleCalls.length = 0;
  annotationCalls.length = 0;
  uniqueCalls.length = 0;
  historyCalls.length = 0;
});

const CREATED_AT = new Date("2026-07-31T10:00:00.000Z");

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-query",
    status: ArticleContentVersionStatus.ACTIVE,
    fingerprint: "v1:fingerprint",
    fingerprintVersion: 1,
    extractorVersion: 2,
    requestedById: null,
    reason: "publisher correction",
    failureReason: null,
    wordCount: 100,
    readingMinutes: 1,
    pendingForArticleId: null,
    activeForArticleId: "article-query",
    derivedRegenerationRequestedAt: null,
    unresolvedAnchorCount: 0,
    unresolvedAnchorIds: ["highlight-1", 42, "highlight-2"],
    createdAt: CREATED_AT,
    activatedAt: CREATED_AT,
    supersededAt: null,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

test("active/pending helpers map metadata and normalize unresolved anchor ids", async () => {
  const { countArticleAnnotations, getActiveVersion, getPendingVersion } =
    await import("@/lib/scraper/incremental/force-rescrape-query");
  annotationCount = 3;
  uniqueRows = [version(), null];

  assert.equal(await countArticleAnnotations("article-query"), 3);
  const active = await getActiveVersion("article-query");
  assert.deepEqual(active?.unresolvedAnchorIds, ["highlight-1", "highlight-2"]);
  assert.equal(active?.isActive, true);
  assert.equal(active?.isPending, false);
  assert.equal(await getPendingVersion("article-query"), null);
  assert.equal(annotationCalls.length, 1);
});

test("status returns null for a missing Article without querying version history", async () => {
  const { getForceRescrapeStatus } = await import("@/lib/scraper/incremental/force-rescrape-query");
  articleExists = false;

  assert.equal(await getForceRescrapeStatus("missing"), null);
  assert.equal(uniqueCalls.length, 0);
  assert.equal(historyCalls.length, 0);
});

test("status maps active, pending, and bounded newest-first history", async () => {
  const { getForceRescrapeStatus } = await import("@/lib/scraper/incremental/force-rescrape-query");
  annotationCount = 7;
  uniqueRows = [
    version(),
    version({
      id: "version-pending",
      status: ArticleContentVersionStatus.PENDING,
      activeForArticleId: null,
      pendingForArticleId: "article-query",
      unresolvedAnchorIds: [],
    }),
  ];
  historyRows = [version({ id: "version-history", unresolvedAnchorIds: { legacy: true } })];

  const status = await getForceRescrapeStatus("article-query", 500);

  assert.equal(status?.activeVersion?.id, "version-query");
  assert.equal(status?.pendingVersion?.id, "version-pending");
  assert.equal(status?.pendingVersion?.unresolvedAnchorIds, null);
  assert.equal(status?.annotationCount, 7);
  assert.equal(status?.versions[0]?.unresolvedAnchorIds, null);
  assert.equal((historyCalls[0] as { take: number }).take, 100);
});
