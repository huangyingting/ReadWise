/** Guarded review-race recovery coverage for candidate review commits. */
process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

import { CrawlCandidateStatus } from "@prisma/client";

type State = { status: CrawlCandidateStatus; articleId: string | null } | null;
let stateReads: State[] = [];
let transactionError: Error | null = null;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        crawlCandidate: {
          findUnique: async () => stateReads.shift() ?? null,
        },
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
          if (transactionError) throw transactionError;
          return fn({
            crawlCandidate: {
              updateMany: async () => ({ count: 0 }),
            },
          });
        },
      },
    },
  });
  mock.module("@/lib/runtime-config/scraper", {
    namedExports: { isCandidateIngestEnabled: () => false },
  });
  mock.module("@/lib/jobs/enqueue", {
    namedExports: { enqueueCandidateIngestInTx: async () => ({ enqueued: true }) },
  });
});

beforeEach(() => {
  stateReads = [];
  transactionError = null;
});

const reviewable = { status: CrawlCandidateStatus.NEEDS_REVIEW, articleId: null };

test("a stale review whose candidate vanished resolves to not-found", async () => {
  const { applyCandidateReview } = await import("@/lib/scraper/incremental/candidate-review-commit");
  stateReads = [reviewable, null];

  assert.deepEqual(await applyCandidateReview({ candidateId: "candidate-race", action: "approve" }), {
    ok: false,
    reason: "not-found",
    action: "approve",
    candidateId: "candidate-race",
  });
});

test("a concurrent identical review resolves to an idempotent no-op", async () => {
  const { applyCandidateReview } = await import("@/lib/scraper/incremental/candidate-review-commit");
  stateReads = [reviewable, { status: CrawlCandidateStatus.QUEUED, articleId: null }];

  const outcome = await applyCandidateReview({ candidateId: "candidate-race", action: "approve" });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.kind, "noop");
});

test("a conflicting concurrent state change resolves to stale", async () => {
  const { applyCandidateReview } = await import("@/lib/scraper/incremental/candidate-review-commit");
  stateReads = [reviewable, { status: CrawlCandidateStatus.DISCOVERED, articleId: null }];

  assert.deepEqual(await applyCandidateReview({ candidateId: "candidate-race", action: "approve" }), {
    ok: false,
    reason: "stale",
    action: "approve",
    candidateId: "candidate-race",
    status: CrawlCandidateStatus.DISCOVERED,
  });
});

test("an unrelated transaction failure propagates unchanged", async () => {
  const { applyCandidateReview } = await import("@/lib/scraper/incremental/candidate-review-commit");
  const error = new Error("database unavailable");
  transactionError = error;
  stateReads = [reviewable];

  await assert.rejects(
    () => applyCandidateReview({ candidateId: "candidate-race", action: "approve" }),
    error,
  );
});
