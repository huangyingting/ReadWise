process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";
import { CrawlCandidateStatus } from "@prisma/client";
import { INGEST_FAILURE_REASON } from "@/lib/scraper/incremental/ingest-outcome";

type CandidateRow = {
  id: string;
  status: CrawlCandidateStatus;
  observedInBaseline: boolean;
  articleId: string | null;
  lastFailureReason: string | null;
  extractorVersion: number | null;
};

let transactionError: Error | null = null;
let eligibleIds: string[] = [];
const candidateRows = new Map<string, CandidateRow>();

before(() => {
  mock.module("@/lib/observability/logger", {
    namedExports: {
      createLogger: () => ({
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      }),
    },
  });
  mock.module("@/lib/jobs/enqueue", {
    namedExports: {
      enqueueJobInTx: async (_tx: unknown, _type: unknown, _payload: unknown, dedupeKey: string) => ({
        id: `job:${dedupeKey}`,
      }),
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        crawlCandidate: {
          findMany: async () => eligibleIds.map((id) => ({ id })),
        },
        $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
          if (transactionError) throw transactionError;
          return callback({
            crawlCandidate: {
              findUnique: async ({ where }: { where: { id: string } }) =>
                candidateRows.get(where.id) ?? null,
              updateMany: async ({ where }: { where: { id: string } }) => ({
                count: where.id === "conflict" ? 0 : 1,
              }),
            },
          });
        },
      },
    },
  });
});

beforeEach(() => {
  transactionError = null;
  eligibleIds = [];
  candidateRows.clear();
});

async function loadRecovery() {
  return import("@/lib/scraper/incremental/ingest-recovery");
}

function eligibleCandidate(id: string): CandidateRow {
  return {
    id,
    status: CrawlCandidateStatus.QUARANTINED,
    observedInBaseline: false,
    articleId: null,
    lastFailureReason: INGEST_FAILURE_REASON.EXTRACTION_INCOMPLETE,
    extractorVersion: 1,
  };
}

test("ingest recovery propagates unexpected transaction failures", async () => {
  const { applyIngestClassification, reactivateCandidate } = await loadRecovery();
  transactionError = new Error("database unavailable");

  await assert.rejects(
    applyIngestClassification({
      candidateId: "candidate-1",
      classification: {
        disposition: "retry",
        reason: INGEST_FAILURE_REASON.HTTP_5XX,
      },
      now: new Date("2026-07-31T00:00:00.000Z"),
      extractorVersion: 2,
    }),
    /database unavailable/,
  );
  await assert.rejects(
    reactivateCandidate("candidate-1", 2),
    /database unavailable/,
  );
});

test("bounded reactivation distinguishes successes, conflicts, and skipped candidates", async () => {
  const { reactivateEligibleCandidates } = await loadRecovery();
  eligibleIds = ["reactivated", "conflict", "missing"];
  candidateRows.set("reactivated", eligibleCandidate("reactivated"));
  candidateRows.set("conflict", eligibleCandidate("conflict"));

  assert.deepEqual(
    await reactivateEligibleCandidates(2, 3, new Date("2026-07-31T00:00:00.000Z")),
    {
      scanned: 3,
      reactivated: 1,
      conflicts: 1,
      skipped: 1,
    },
  );
});
