import assert from "node:assert/strict";
import { before, mock, test } from "node:test";

import type { AdvanceBackfillResult } from "@/lib/scraper/incremental/backfill-commit";
import type { BackfillLoopDeps } from "@/lib/worker/backfill-loop";
import type { WorkerLogger } from "@/lib/worker/types";

before(() => {
  mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
});

function recordingLogger() {
  const errors: Array<{ message: string; meta?: Record<string, unknown> }> = [];
  const logger: WorkerLogger = {
    info: () => {},
    warn: () => {},
    error: (message, meta) => errors.push({ message, meta }),
  };
  return { errors, logger };
}

function outcomeById(runId: string): AdvanceBackfillResult {
  switch (runId) {
    case "advanced":
      return {
        ok: true,
        kind: "advanced",
        reactivated: 3,
        skipped: 2,
        batchSize: 5,
        lastId: "candidate-5",
      };
    case "completed":
      return { ok: true, kind: "completed", reason: "drained" };
    case "missing":
      return { ok: false, reason: "not-found" };
    default:
      return { ok: true, kind: "contended" };
  }
}

test("once mode advances every runnable run and tallies only applied outcomes", async () => {
  const { runBackfillLoop } = await import("@/lib/worker/backfill-loop");
  const calls: Array<{ runId: string; batchSize: number }> = [];
  const { logger } = recordingLogger();
  const deps: BackfillLoopDeps = {
    batchSize: 17,
    listRunnableBackfillRunIds: async () => [
      "advanced",
      "completed",
      "missing",
      "contended",
    ],
    advanceBackfillRun: async (input) => {
      calls.push(input);
      return outcomeById(input.runId);
    },
  };

  const stats = await runBackfillLoop("worker-a", { once: true }, logger, deps);

  assert.deepEqual(calls, [
    { runId: "advanced", batchSize: 17 },
    { runId: "completed", batchSize: 17 },
    { runId: "missing", batchSize: 17 },
    { runId: "contended", batchSize: 17 },
  ]);
  assert.deepEqual(stats, {
    polls: 1,
    runsAdvanced: 4,
    batches: 1,
    reactivated: 3,
    skipped: 2,
    completed: 1,
    failed: 0,
    stoppedBySignal: false,
  });
});

test("one failed run is sanitized and isolated from the rest of the pass", async () => {
  const { runBackfillLoop } = await import("@/lib/worker/backfill-loop");
  const attempted: string[] = [];
  const { errors, logger } = recordingLogger();

  const stats = await runBackfillLoop("worker-private", { once: true }, logger, {
    batchSize: 4,
    listRunnableBackfillRunIds: async () => ["bad", "good"],
    advanceBackfillRun: async ({ runId }) => {
      attempted.push(runId);
      if (runId === "bad") throw new Error("private article body");
      return outcomeById("advanced");
    },
  });

  assert.deepEqual(attempted, ["bad", "good"]);
  assert.equal(stats.failed, 1);
  assert.equal(stats.runsAdvanced, 1);
  assert.deepEqual(errors, [
    {
      message: "backfill run advance failed",
      meta: {
        workerId: "worker-private",
        runId: "bad",
        failureReason: "backfill_advance_failed",
      },
    },
  ]);
  assert.doesNotMatch(JSON.stringify(errors), /private article body/);
});

test("an already-aborted signal stops before polling", async () => {
  const { runBackfillLoop } = await import("@/lib/worker/backfill-loop");
  const controller = new AbortController();
  controller.abort();
  let listed = false;
  const { logger } = recordingLogger();

  const stats = await runBackfillLoop(
    "worker-a",
    { once: true, signal: controller.signal },
    logger,
    {
      listRunnableBackfillRunIds: async () => {
        listed = true;
        return [];
      },
    },
  );

  assert.equal(listed, false);
  assert.equal(stats.polls, 0);
  assert.equal(stats.stoppedBySignal, true);
});

test("an abort between run advances stops the current pass", async () => {
  const { runBackfillLoop } = await import("@/lib/worker/backfill-loop");
  const controller = new AbortController();
  const attempted: string[] = [];
  const { logger } = recordingLogger();

  const stats = await runBackfillLoop(
    "worker-a",
    { once: true, signal: controller.signal },
    logger,
    {
      listRunnableBackfillRunIds: async () => ["first", "never"],
      advanceBackfillRun: async ({ runId }) => {
        attempted.push(runId);
        controller.abort();
        return outcomeById("advanced");
      },
    },
  );

  assert.deepEqual(attempted, ["first"]);
  assert.equal(stats.runsAdvanced, 1);
  assert.equal(stats.stoppedBySignal, true);
});

test("idle polling sleeps with the configured interval and handles abort", async () => {
  const [{ runBackfillLoop }, { AbortError }] = await Promise.all([
    import("@/lib/worker/backfill-loop"),
    import("@/lib/worker/sleep"),
  ]);
  const sleeps: Array<{ ms: number; signal?: AbortSignal }> = [];
  const controller = new AbortController();
  const { logger } = recordingLogger();

  const stats = await runBackfillLoop(
    "worker-a",
    { pollIntervalMs: 123, signal: controller.signal },
    logger,
    {
      listRunnableBackfillRunIds: async () => [],
      sleep: async (ms, signal) => {
        sleeps.push({ ms, signal });
        throw new AbortError();
      },
    },
  );

  assert.deepEqual(sleeps, [{ ms: 123, signal: controller.signal }]);
  assert.equal(stats.polls, 1);
  assert.equal(stats.stoppedBySignal, true);
});

test("continuous mode resumes after idle and sleeps again after advancing", async () => {
  const [{ runBackfillLoop }, { AbortError }] = await Promise.all([
    import("@/lib/worker/backfill-loop"),
    import("@/lib/worker/sleep"),
  ]);
  const listResults = [[], ["ready"]];
  const attempted: string[] = [];
  const sleeps: number[] = [];
  const { logger } = recordingLogger();

  const stats = await runBackfillLoop("worker-a", { pollIntervalMs: 25 }, logger, {
    listRunnableBackfillRunIds: async () => listResults.shift() ?? [],
    advanceBackfillRun: async ({ runId }) => {
      attempted.push(runId);
      return outcomeById("completed");
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      if (sleeps.length === 2) throw new AbortError();
    },
  });

  assert.deepEqual(attempted, ["ready"]);
  assert.deepEqual(sleeps, [25, 25]);
  assert.equal(stats.polls, 2);
  assert.equal(stats.completed, 1);
  assert.equal(stats.stoppedBySignal, true);
});

test("an abort raised by one advance stops before later runs", async () => {
  const [{ runBackfillLoop }, { AbortError }] = await Promise.all([
    import("@/lib/worker/backfill-loop"),
    import("@/lib/worker/sleep"),
  ]);
  const attempted: string[] = [];
  const { errors, logger } = recordingLogger();

  const stats = await runBackfillLoop("worker-a", { once: true }, logger, {
    listRunnableBackfillRunIds: async () => ["aborted", "never"],
    advanceBackfillRun: async ({ runId }) => {
      attempted.push(runId);
      throw new AbortError();
    },
  });

  assert.deepEqual(attempted, ["aborted"]);
  assert.equal(stats.runsAdvanced, 0);
  assert.equal(stats.failed, 0);
  assert.equal(stats.stoppedBySignal, true);
  assert.deepEqual(errors, []);
});

test("a fatal listing failure is sanitized, logged, and rethrown", async () => {
  const { runBackfillLoop } = await import("@/lib/worker/backfill-loop");
  const failure = new Error("database connection secret");
  const { errors, logger } = recordingLogger();

  await assert.rejects(
    runBackfillLoop("worker-a", { once: true }, logger, {
      listRunnableBackfillRunIds: async () => {
        throw failure;
      },
    }),
    (error) => error === failure,
  );

  assert.deepEqual(errors, [
    {
      message: "backfill loop crashed",
      meta: { failureReason: "backfill_loop_failed" },
    },
  ]);
  assert.doesNotMatch(JSON.stringify(errors), /database connection secret/);
});
