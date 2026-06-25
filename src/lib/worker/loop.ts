import { recordWorkerJob } from "@/lib/metrics";
import { withSpan } from "@/lib/observability/tracing";
import { captureError } from "@/lib/observability/errors";
import {
  claimNextJob,
  completeJob,
  failJob,
  startJob,
  JobError,
  JobStatus,
  type JobType,
} from "@/lib/jobs";
import { sleep, isAbort } from "./sleep";
import type { WorkerLogger, JobHandler, JobWorkerStats } from "./types";

/** Options forwarded from JobWorkerOptions that the loop needs. */
export type WorkerLoopOptions = {
  pollIntervalMs?: number;
  lockTtlMs?: number;
  types?: JobType[];
  once?: boolean;
  signal?: AbortSignal;
  process?: { tts?: boolean; translateLangs?: string[] };
};

/** Injectable dependencies for the runtime loop (all default to real implementations). */
export type WorkerLoopDeps = {
  claimNextJob?: typeof claimNextJob;
  startJob?: typeof startJob;
  completeJob?: typeof completeJob;
  failJob?: typeof failJob;
  sleep?: typeof sleep;
};

/**
 * Core runtime loop: claims, starts, dispatches, completes, and fails jobs
 * until the queue is drained or the signal fires. The loop knows nothing about
 * specific job types — it only calls the handler looked up from the registry.
 */
export async function runWorkerLoop(
  workerId: string,
  handlers: Partial<Record<JobType, JobHandler>>,
  options: WorkerLoopOptions,
  logger: WorkerLogger,
  deps: WorkerLoopDeps = {},
): Promise<JobWorkerStats> {
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const signal = options.signal;
  const claimFn = deps.claimNextJob ?? claimNextJob;
  const startFn = deps.startJob ?? startJob;
  const completeFn = deps.completeJob ?? completeJob;
  const failFn = deps.failJob ?? failJob;
  const sleepFn = deps.sleep ?? sleep;

  const stats: JobWorkerStats = {
    polls: 0,
    claimed: 0,
    completed: 0,
    failed: 0,
    retried: 0,
    deadLettered: 0,
    stoppedBySignal: false,
  };

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
      const startedAt = Date.now();
      const attempts = job.attempts + 1;

      try {
        await startFn(job.id, workerId);
        const handler = handlers[job.type as JobType];
        if (!handler) {
          throw new JobError(`no handler registered for job type ${job.type}`, {
            kind: "validation",
          });
        }
        await withSpan(
          "worker.job",
          { "readwise.job_type": job.type, "readwise.attempt": attempts },
          () => handler(job, { logger, signal, process: options.process }),
        );
        await completeFn(job.id);
        stats.completed++;
        recordWorkerJob({ outcome: "success", attempts, durationMs: Date.now() - startedAt });
      } catch (err) {
        if (isAbort(err)) {
          stats.stoppedBySignal = true;
          recordWorkerJob({ outcome: "aborted", attempts, durationMs: Date.now() - startedAt });
          break;
        }
        const updated = await failFn(job.id, err);
        stats.failed++;
        const deadLettered = updated?.status === JobStatus.DEAD_LETTER;
        if (deadLettered) {
          stats.deadLettered++;
        } else {
          stats.retried++;
        }
        recordWorkerJob({ outcome: "failed", attempts, durationMs: Date.now() - startedAt });
        captureError(err, {
          source: "worker",
          severity: deadLettered ? "fatal" : "warning",
          extra: { jobId: job.id, jobType: job.type, attempts, deadLettered },
        });
        logger.warn("job handler failed", {
          jobId: job.id,
          type: job.type,
          deadLettered,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    if (isAbort(err)) {
      stats.stoppedBySignal = true;
    } else {
      logger.error("job worker loop crashed", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  return stats;
}
