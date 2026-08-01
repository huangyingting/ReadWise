/** Defensive bound and guarded-race coverage for backfill commits. */
process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

import { BackfillRunStatus } from "@prisma/client";

type OuterRun = Record<string, unknown> | null;
let outerRunReads: OuterRun[] = [];
let batch: Array<{ id: string }> = [];
let txFreshRun: Record<string, unknown> | null = null;
let candidateUpdateCount = 1;
let runUpdateCount = 1;
let transactionError: Error | null = null;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        backfillRun: {
          findUnique: async () => outerRunReads.shift() ?? null,
          updateMany: async () => ({ count: 1 }),
        },
        crawlCandidate: {
          findMany: async () => batch,
        },
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
          if (transactionError) throw transactionError;
          return fn({
            backfillRun: {
              findUnique: async () => txFreshRun,
              updateMany: async () => ({ count: runUpdateCount }),
            },
            crawlCandidate: {
              updateMany: async () => ({ count: candidateUpdateCount }),
            },
          });
        },
      },
    },
  });
  mock.module("@/lib/runtime-config/scraper", {
    namedExports: { isCandidateIngestEnabled: () => false },
  });
  mock.module("@/lib/jobs", {
    namedExports: { enqueueCandidateIngestInTx: async () => ({ enqueued: true }) },
  });
});

beforeEach(() => {
  outerRunReads = [];
  batch = [];
  txFreshRun = { status: BackfillRunStatus.RUNNING, checkpointCursor: null };
  candidateUpdateCount = 1;
  runUpdateCount = 1;
  transactionError = null;
});

const NOW = new Date("2026-07-31T18:00:00.000Z");

function runningRun(overrides: Record<string, unknown> = {}) {
  return {
    providerKey: "provider-backfill-branches",
    discoverySourceId: null,
    status: BackfillRunStatus.RUNNING,
    windowStart: new Date("2026-07-01T00:00:00.000Z"),
    windowEnd: new Date("2026-07-31T00:00:00.000Z"),
    maxItems: 10,
    reactivatedCount: 0,
    checkpointCursor: null,
    ...overrides,
  };
}

test("a malformed run without concrete bounds is never scanned", async () => {
  const { advanceBackfillRun } = await import("@/lib/scraper/incremental/backfill-commit");
  outerRunReads = [runningRun({ windowStart: null })];

  assert.deepEqual(await advanceBackfillRun({ runId: "run-branches", batchSize: 10, now: NOW }), {
    ok: true,
    kind: "inactive",
    status: BackfillRunStatus.RUNNING,
  });
});

test("a candidate changed after selection is counted as skipped", async () => {
  const { advanceBackfillRun } = await import("@/lib/scraper/incremental/backfill-commit");
  outerRunReads = [runningRun()];
  batch = [{ id: "candidate-changed" }];
  candidateUpdateCount = 0;

  assert.deepEqual(await advanceBackfillRun({ runId: "run-branches", batchSize: 10, now: NOW }), {
    ok: true,
    kind: "advanced",
    reactivated: 0,
    skipped: 1,
    batchSize: 1,
    lastId: "candidate-changed",
  });
});

test("a run changed before the transaction re-read is reported as contended", async () => {
  const { advanceBackfillRun } = await import("@/lib/scraper/incremental/backfill-commit");
  outerRunReads = [runningRun()];
  batch = [{ id: "candidate-contended" }];
  txFreshRun = null;

  assert.deepEqual(await advanceBackfillRun({ runId: "run-branches", batchSize: 10, now: NOW }), {
    ok: true,
    kind: "contended",
  });
});

test("an unrelated advance transaction failure propagates", async () => {
  const { advanceBackfillRun } = await import("@/lib/scraper/incremental/backfill-commit");
  const error = new Error("database unavailable");
  outerRunReads = [runningRun()];
  batch = [{ id: "candidate-error" }];
  transactionError = error;

  await assert.rejects(
    () => advanceBackfillRun({ runId: "run-branches", batchSize: 10, now: NOW }),
    error,
  );
});

async function stalePause(fresh: OuterRun) {
  const { pauseBackfillRun } = await import("@/lib/scraper/incremental/backfill-commit");
  outerRunReads = [{ status: BackfillRunStatus.RUNNING }, fresh];
  runUpdateCount = 0;
  return pauseBackfillRun("run-control", NOW);
}

test("a stale control whose run vanished resolves to not-found", async () => {
  assert.deepEqual(await stalePause(null), { ok: false, reason: "not-found", action: "pause" });
});

test("a concurrent identical control resolves to an idempotent no-op", async () => {
  const outcome = await stalePause({ status: BackfillRunStatus.PAUSED });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.kind, "noop");
});

test("a conflicting control state resolves to stale", async () => {
  assert.deepEqual(await stalePause({ status: BackfillRunStatus.COMPLETED }), {
    ok: false,
    reason: "stale",
    action: "pause",
    status: BackfillRunStatus.COMPLETED,
  });
});

test("an unrelated control transaction failure propagates", async () => {
  const { pauseBackfillRun } = await import("@/lib/scraper/incremental/backfill-commit");
  const error = new Error("transaction unavailable");
  outerRunReads = [{ status: BackfillRunStatus.RUNNING }];
  transactionError = error;

  await assert.rejects(() => pauseBackfillRun("run-control", NOW), error);
});
