/**
 * Unit tests for the #1093 classification SEAM wiring in the candidate-ingest
 * worker handler. Mocks the thin persistence (`applyIngestClassification`) and
 * injects a fake `runIngestAttempt` so no DB / network is touched: proves the
 * handler classifies a failure, persists the candidate recovery transition, and
 * throws the correctly-permanent JobError for the worker's fail path.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { CrawlCandidateStatus } from "@prisma/client";

type ApplyCall = Record<string, unknown>;
let applyCalls: ApplyCall[] = [];

before(() => {
  mock.module("@/lib/scraper/incremental/ingest-recovery", {
    namedExports: {
      applyIngestClassification: async (params: ApplyCall) => {
        applyCalls.push(params);
        return { applied: "retry" };
      },
    },
  });
});

beforeEach(() => {
  applyCalls = [];
});

const logger = { info: () => {}, warn: () => {}, error: () => {} };

function job(payload: unknown): never {
  return { id: "job-1", payload, attempts: 0 } as never;
}

async function loadImports() {
  const { makeCandidateIngestHandler } = await import("@/lib/worker/registry");
  const { JobError } = await import("@/lib/jobs");
  const { INGEST_FAILURE_REASON } = await import("@/lib/scraper/incremental/ingest-outcome");
  return { makeCandidateIngestHandler, JobError, INGEST_FAILURE_REASON };
}

function candidateRow(overrides = {}) {
  return {
    id: "cand-1",
    status: CrawlCandidateStatus.DISCOVERED,
    observedInBaseline: false,
    articleId: null,
    ingestAttemptCount: 0,
    firstIngestAttemptAt: null,
    ...overrides,
  };
}

test("seam: a transient failure classifies to a NON-permanent JobError and persists recovery", async () => {
  const { makeCandidateIngestHandler, JobError, INGEST_FAILURE_REASON } = await loadImports();
  const handler = makeCandidateIngestHandler(async () => candidateRow(), {
    runIngestAttempt: async () => ({ ok: false, outcome: { kind: "http-error", status: 503 } }),
    now: () => new Date("2026-07-19T00:00:00.000Z"),
  });

  await assert.rejects(
    () => handler(job({ candidateId: "cand-1", processingVersion: 1 }), { logger }),
    (err: unknown) =>
      err instanceof JobError && err.permanent === false && err.message === INGEST_FAILURE_REASON.HTTP_5XX,
  );
  assert.equal(applyCalls.length, 1);
  assert.equal((applyCalls[0].classification as { disposition: string }).disposition, "retry");
});

test("seam: a permanent failure (410) classifies to a PERMANENT JobError (dead-letter)", async () => {
  const { makeCandidateIngestHandler, JobError, INGEST_FAILURE_REASON } = await loadImports();
  const handler = makeCandidateIngestHandler(async () => candidateRow(), {
    runIngestAttempt: async () => ({ ok: false, outcome: { kind: "http-error", status: 410 } }),
    now: () => new Date("2026-07-19T00:00:00.000Z"),
  });

  await assert.rejects(
    () => handler(job({ candidateId: "cand-1", processingVersion: 1 }), { logger }),
    (err: unknown) =>
      err instanceof JobError && err.permanent === true && err.message === INGEST_FAILURE_REASON.HTTP_410_GONE,
  );
  assert.equal((applyCalls[0].classification as { disposition: string }).disposition, "terminal");
});

test("seam: a successful attempt neither persists recovery nor throws", async () => {
  const { makeCandidateIngestHandler } = await loadImports();
  const handler = makeCandidateIngestHandler(async () => candidateRow(), {
    runIngestAttempt: async () => ({ ok: true }),
  });
  await handler(job({ candidateId: "cand-1", processingVersion: 1 }), { logger });
  assert.equal(applyCalls.length, 0);
});

test("seam: without a runIngestAttempt the handler stays a #1095 hand-off no-op", async () => {
  const { makeCandidateIngestHandler } = await loadImports();
  const handler = makeCandidateIngestHandler(async () => candidateRow());
  await handler(job({ candidateId: "cand-1", processingVersion: 1 }), { logger });
  assert.equal(applyCalls.length, 0);
});
