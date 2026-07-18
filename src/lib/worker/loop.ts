import {
  claimNextJob,
  type JobType,
} from "@/lib/jobs";
import { sleep, isAbort } from "./sleep";
import type { ClaimedJobExecutor } from "./claimed-execution";
import type { WorkerLogger, JobWorkerStats } from "./types";

/** Options forwarded from JobWorkerOptions that the loop needs. */
export type WorkerLoopOptions = {
  pollIntervalMs?: number;
  lockTtlMs?: number;
  types?: JobType[];
  once?: boolean;
  signal?: AbortSignal;
};

/** Injectable dependencies for the runtime loop (all default to real implementations). */
export type WorkerLoopDeps = {
  claimNextJob?: typeof claimNextJob;
  sleep?: typeof sleep;
};

function initialStats(): JobWorkerStats {
  return {
    polls: 0,
    claimed: 0,
    completed: 0,
    failed: 0,
    retried: 0,
    deadLettered: 0,
    stoppedBySignal: false,
  };
}

function recordFailureStats(stats: JobWorkerStats, deadLettered: boolean): void {
  stats.failed++;
  if (deadLettered) {
    stats.deadLettered++;
  } else {
    stats.retried++;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Polls for work and delegates each claimed Job to the supplied executor until
 * the queue is drained or the signal fires.
 */
export async function runWorkerLoop(
  workerId: string,
  executeClaimedJob: ClaimedJobExecutor,
  options: WorkerLoopOptions,
  logger: WorkerLogger,
  deps: WorkerLoopDeps = {},
): Promise<JobWorkerStats> {
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const signal = options.signal;
  const claimFn = deps.claimNextJob ?? claimNextJob;
  const sleepFn = deps.sleep ?? sleep;
  const stats = initialStats();

  try {
    for (;;) {
      if (signal?.aborted) {
        stats.stoppedBySignal = true;
        break;
      }

      stats.polls++;
      const job = await claimFn(workerId, {
        types: options.types,
        lockTtlMs: options.lockTtlMs,
      });

      if (!job) {
        if (options.once) {
          logger.info("job queue drained, stopping (once mode)");
          break;
        }
        await sleepFn(pollIntervalMs, signal);
        continue;
      }

      stats.claimed++;
      const result = await executeClaimedJob(job);

      switch (result.outcome) {
        case "completed":
          stats.completed++;
          break;
        case "failed":
          recordFailureStats(stats, result.deadLettered);
          break;
        case "stopped":
          stats.stoppedBySignal = true;
          return stats;
        case "aborted":
        case "skipped":
          break;
      }
    }
  } catch (err) {
    if (isAbort(err)) {
      stats.stoppedBySignal = true;
    } else {
      logger.error("job worker loop crashed", {
        error: errorMessage(err),
      });
      throw err;
    }
  }

  return stats;
}
