process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

type CandidateRow = Record<string, unknown>;

const countCalls: unknown[] = [];
const listCalls: unknown[] = [];
const detailCalls: unknown[] = [];
let countResult = 0;
let listRows: CandidateRow[] = [];
let detailRow: CandidateRow | null = null;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        crawlCandidate: {
          count: async (args: unknown) => {
            countCalls.push(args);
            return countResult;
          },
          findMany: async (args: unknown) => {
            listCalls.push(args);
            return listRows;
          },
          findUnique: async (args: unknown) => {
            detailCalls.push(args);
            return detailRow;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  countCalls.length = 0;
  listCalls.length = 0;
  detailCalls.length = 0;
  countResult = 0;
  listRows = [];
  detailRow = null;
});

function row(overrides: CandidateRow = {}): CandidateRow {
  return {
    id: "candidate-1",
    providerKey: "undark",
    discoverySourceId: null,
    identityVersion: 2,
    provisionalKey: "v2:abc",
    canonicalKey: null,
    status: "NEEDS_REVIEW",
    observedInBaseline: false,
    firstObservedAt: new Date("2026-07-01T00:00:00Z"),
    lastObservedAt: new Date("2026-07-02T00:00:00Z"),
    observationCount: 3,
    terminalReason: "ambiguous-date",
    terminalAt: null,
    dateProvenance: "UNKNOWN",
    trustedPublishedAt: null,
    lastFailureReason: null,
    ingestAttemptCount: 1,
    articleId: null,
    ...overrides,
  };
}

test("candidate review query maps the default FIFO page and clamps pagination", async () => {
  countResult = 1;
  listRows = [row()];
  const { listReviewCandidates, REVIEW_QUEUE_STATUSES } = await import(
    "@/lib/scraper/incremental/candidate-review-query"
  );

  const page = await listReviewCandidates({ offset: -9, limit: 0 });

  assert.deepEqual(REVIEW_QUEUE_STATUSES, ["NEEDS_REVIEW", "SKIPPED_REVIEW"]);
  assert.equal(page.total, 1);
  assert.equal(page.offset, 0);
  assert.equal(page.limit, 1);
  assert.equal(page.candidates[0]?.reviewReason, "ambiguous-date");
  assert.equal(page.candidates[0]?.hasArticle, false);
  assert.deepEqual((countCalls[0] as { where: unknown }).where, { status: "NEEDS_REVIEW" });
  assert.deepEqual(listCalls[0], {
    where: { status: "NEEDS_REVIEW" },
    select: (listCalls[0] as { select: unknown }).select,
    orderBy: [{ firstObservedAt: "asc" }, { id: "asc" }],
    skip: 0,
    take: 1,
  });
});

test("candidate review query forwards every sanitized filter and caps the page", async () => {
  listRows = [row({ articleId: "article-1", discoverySourceId: "source-1", status: "SKIPPED_REVIEW" })];
  const { listReviewCandidates } = await import("@/lib/scraper/incremental/candidate-review-query");

  const page = await listReviewCandidates({
    status: "SKIPPED_REVIEW",
    providerKey: "undark",
    discoverySourceId: "source-1",
    offset: 5,
    limit: 999,
  });

  assert.equal(page.limit, 200);
  assert.equal(page.candidates[0]?.hasArticle, true);
  assert.deepEqual((countCalls[0] as { where: unknown }).where, {
    status: "SKIPPED_REVIEW",
    providerKey: "undark",
    discoverySourceId: "source-1",
  });
});

test("candidate review detail returns null or maps sanitized conflict history", async () => {
  const { getReviewCandidate } = await import("@/lib/scraper/incremental/candidate-review-query");

  assert.equal(await getReviewCandidate("missing"), null);

  detailRow = row({
    conflicts: [
      {
        id: "conflict-1",
        status: "OPEN",
        reason: "identity-collision",
        detectedAt: new Date("2026-07-03T00:00:00Z"),
        resolvedAt: null,
      },
    ],
  });
  const detail = await getReviewCandidate("candidate-1");

  assert.equal(detail?.id, "candidate-1");
  assert.equal(detail?.conflicts[0]?.reason, "identity-collision");
  assert.deepEqual((detailCalls.at(-1) as { where: unknown }).where, { id: "candidate-1" });
});
