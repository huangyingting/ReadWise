/**
 * Backfill driver loop (issue #1101, Phase 3.2).
 *
 * A sibling scheduling pass driven by the SAME worker runtime (NOT a second
 * daemon), mirroring `discovery-loop.ts`: each tick it lists the RUNNING
 * {@link BackfillRun}s and advances each one bounded batch via
 * {@link advanceBackfillRun}, which reactivates matching historical identities
 * (transition + LOW-priority ingest enqueue) and advances the durable
 * checkpoint. It owns NO decision logic and fetches NO bodies — the actual
 * article ingestion is the ordinary candidate-ingest Job the advance enqueues,
 * processed by the normal Job loop (always AFTER real-time work, because the
 * backfill Jobs run at {@link BACKFILL_JOB_PRIORITY}).
 *
 * Restart-safe by construction: progress lives in `BackfillRun.checkpointCursor`
 * + the RUNNING status, so after a worker restart the loop simply re-lists the
 * RUNNING runs and resumes each from its checkpoint — it never widens the
 * approved range and never double-reactivates (the advance is guarded). Failure
 * isolation: a single run that throws never stops the pass or the Job loop.
 */
import {
  advanceBackfillRun,
  type AdvanceBackfillResult,
} from "@/lib/scraper/incremental/backfill-commit";
import { listRunnableBackfillRunIds } from "@/lib/scraper/incremental/backfill-query";
import { scraperBackfillBatchSize } from "@/lib/runtime-config/scraper";

import { sleep, isAbort } from "./sleep";
import type { WorkerLogger } from "./types";

/** Options forwarded to the backfill driver pass. */
export type BackfillLoopOptions = {
  pollIntervalMs?: number;
  once?: boolean;
  signal?: AbortSignal;
};

/** Injectable dependencies for the backfill pass (all default to real ones). */
export type BackfillLoopDeps = {
  advanceBackfillRun?: typeof advanceBackfillRun;
  listRunnableBackfillRunIds?: typeof listRunnableBackfillRunIds;
  batchSize?: number;
  sleep?: typeof sleep;
};

export type BackfillLoopStats = {
  polls: number;
  runsAdvanced: number;
  batches: number;
  reactivated: number;
  skipped: number;
  completed: number;
  failed: number;
  stoppedBySignal: boolean;
};

function initialStats(): BackfillLoopStats {
  return {
    polls: 0,
    runsAdvanced: 0,
    batches: 0,
    reactivated: 0,
    skipped: 0,
    completed: 0,
    failed: 0,
    stoppedBySignal: false,
  };
}

function applyOutcome(stats: BackfillLoopStats, outcome: AdvanceBackfillResult): void {
  if (!outcome.ok) return;
  if (outcome.kind === "advanced") {
    stats.batches += 1;
    stats.reactivated += outcome.reactivated;
    stats.skipped += outcome.skipped;
  } else if (outcome.kind === "completed") {
    stats.completed += 1;
  }
}

/**
 * Runs the backfill driver pass until the signal fires or (in `once` mode) no
 * RUNNING run remains. Each poll advances every currently-RUNNING run by one
 * batch; a run that throws is logged and skipped (never stops the pass).
 */
export async function runBackfillLoop(
  workerId: string,
  options: BackfillLoopOptions,
  logger: WorkerLogger,
  deps: BackfillLoopDeps = {},
): Promise<BackfillLoopStats> {
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const signal = options.signal;
  const advanceFn = deps.advanceBackfillRun ?? advanceBackfillRun;
  const listFn = deps.listRunnableBackfillRunIds ?? listRunnableBackfillRunIds;
  const sleepFn = deps.sleep ?? sleep;
  const batchSize = deps.batchSize ?? scraperBackfillBatchSize();
  const stats = initialStats();

  try {
    for (;;) {
      if (signal?.aborted) {
        stats.stoppedBySignal = true;
        break;
      }

      stats.polls += 1;
      const runIds = await listFn();

      if (runIds.length === 0) {
        if (options.once) break;
        await sleepFn(pollIntervalMs, signal);
        continue;
      }

      for (const runId of runIds) {
        if (signal?.aborted) {
          stats.stoppedBySignal = true;
          break;
        }
        try {
          const outcome = await advanceFn({ runId, batchSize });
          stats.runsAdvanced += 1;
          applyOutcome(stats, outcome);
        } catch (err) {
          if (isAbort(err)) {
            stats.stoppedBySignal = true;
            break;
          }
          stats.failed += 1;
          logger.error("backfill run advance failed", {
            workerId,
            runId,
            failureReason: "backfill_advance_failed",
          });
        }
      }

      if (stats.stoppedBySignal) break;
      if (options.once) break;
      await sleepFn(pollIntervalMs, signal);
    }
  } catch (err) {
    if (isAbort(err)) {
      stats.stoppedBySignal = true;
    } else {
      logger.error("backfill loop crashed", { failureReason: "backfill_loop_failed" });
      throw err;
    }
  }

  return stats;
}
