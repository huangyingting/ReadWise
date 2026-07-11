import { recordWorkerJob } from "@/lib/metrics";
import { withSpan } from "@/lib/observability/tracing";
import { captureError } from "@/lib/observability/errors";
import {
  claimNextJob,
  completeJob,
  failJob,
  heartbeatJob,
  startJob,
  JobError,
  JobStatus,
  DEFAULT_LOCK_TTL_MS,
  type JobType,
} from "@/lib/jobs";
import { sleep, isAbort } from "./sleep";
import type { WorkerLogger, JobHandler, JobWorkerStats } from "./types";

/** Options forwarded from JobWorkerOptions that the loop needs. */
export type WorkerLoopOptions = {
  pollIntervalMs?: number;
  lockTtlMs?: number;
  /** Override heartbeat interval (default: lockTtlMs/2, min 1000ms). Testing only. */
  heartbeatIntervalMs?: number;
  types?: JobType[];
  once?: boolean;
  signal?: AbortSignal;
  process?: { tts?: boolean; translateLangs?: string[] };
};

/** Injectable dependencies for the runtime loop (all default to real implementations). */
export type WorkerLoopDeps = {
  claimNextJob?: typeof claimNextJob;
  startJob?: typeof startJob;
  heartbeatJob?: typeof heartbeatJob;
  completeJob?: typeof completeJob;
  failJob?: typeof failJob;
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
 * Computes heartbeat interval: half the lock TTL, capped at a sensible minimum
 * so we heartbeat well before the lock expires.
 */
function heartbeatIntervalMs(lockTtlMs: number): number {
  return Math.max(1000, Math.floor(lockTtlMs / 2));
}

/**
 * Starts a non-overlapping recursive-timeout heartbeat that refreshes the job
 * lock. Returns a cleanup function. If heartbeat fails (ownership lost or DB
 * error), the handler-scoped AbortController is aborted.
 */
function startHeartbeat(
  jobId: string,
  workerId: string,
  intervalMs: number,
  handlerAbort: AbortController,
  heartbeatFn: typeof heartbeatJob,
  logger: WorkerLogger,
): { stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function tick(): Promise<void> {
    if (stopped || handlerAbort.signal.aborted) return;
    try {
      const ok = await heartbeatFn(jobId, workerId);
      if (!ok) {
        logger.warn("heartbeat ownership lost", { jobId, workerId });
        if (!handlerAbort.signal.aborted) {
          handlerAbort.abort();
        }
        return;
      }
    } catch (err) {
      logger.warn("heartbeat error", { jobId, workerId, error: errorMessage(err) });
      if (!handlerAbort.signal.aborted) {
        handlerAbort.abort();
      }
      return;
    }
    if (!stopped && !handlerAbort.signal.aborted) {
      timer = setTimeout(() => void tick(), intervalMs);
    }
  }

  timer = setTimeout(() => void tick(), intervalMs);

  return {
    stop() {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/**
 * Core runtime loop: claims, starts, dispatches, completes, and fails jobs
 * until the queue is drained or the signal fires. The loop knows nothing about
 * specific job types — it only calls the handler looked up from the registry.
 *
 * Each handler execution runs with a composed AbortSignal (global stop +
 * heartbeat loss). Heartbeat uses recursive setTimeout (no overlap risk).
 */
export async function runWorkerLoop(
  workerId: string,
  handlers: Partial<Record<JobType, JobHandler>>,
  options: WorkerLoopOptions,
  logger: WorkerLogger,
  deps: WorkerLoopDeps = {},
): Promise<JobWorkerStats> {
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const lockTtlMs = options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  const signal = options.signal;
  const claimFn = deps.claimNextJob ?? claimNextJob;
  const startFn = deps.startJob ?? startJob;
  const heartbeatFn = deps.heartbeatJob ?? heartbeatJob;
  const completeFn = deps.completeJob ?? completeJob;
  const failFn = deps.failJob ?? failJob;
  const sleepFn = deps.sleep ?? sleep;

  const hbInterval = options.heartbeatIntervalMs ?? heartbeatIntervalMs(lockTtlMs);
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
      const startedAt = Date.now();
      const attempts = job.attempts + 1;

      // Handler-scoped AbortController: composed with global stop signal.
      const handlerAbort = new AbortController();
      let ownershipLost = false;

      // If the global signal fires, abort the handler scope too.
      const onGlobalAbort = () => {
        if (!handlerAbort.signal.aborted) handlerAbort.abort();
      };
      signal?.addEventListener("abort", onGlobalAbort, { once: true });

      // Track ownership loss from heartbeat.
      const onHandlerAbort = () => {
        if (!signal?.aborted) ownershipLost = true;
      };
      handlerAbort.signal.addEventListener("abort", onHandlerAbort, { once: true });

      let heartbeat: { stop: () => void } | null = null;

      try {
        const started = await startFn(job.id, workerId);
        if (!started) {
          // CAS failed — job was reclaimed between claim and start. Skip.
          signal?.removeEventListener("abort", onGlobalAbort);
          continue;
        }

        const handler = handlers[job.type as JobType];
        if (!handler) {
          throw new JobError(`no handler registered for job type ${job.type}`, {
            kind: "validation",
          });
        }

        // Start heartbeat after successful start transition.
        heartbeat = startHeartbeat(job.id, workerId, hbInterval, handlerAbort, heartbeatFn, logger);

        await withSpan(
          "worker.job",
          { "readwise.job_type": job.type, "readwise.attempt": attempts },
          () => handler(job, { logger, signal: handlerAbort.signal, process: options.process }),
        );

        // Stop heartbeat before completing.
        heartbeat.stop();
        heartbeat = null;

        if (ownershipLost) {
          // Handler completed but we lost ownership — do not call complete.
          recordWorkerJob({ outcome: "aborted", attempts, durationMs: Date.now() - startedAt });
          logger.warn("handler completed after ownership loss, skipping complete", {
            jobId: job.id,
          });
        } else {
          const completed = await completeFn(job.id, workerId);
          if (completed) {
            stats.completed++;
            recordWorkerJob({ outcome: "success", attempts, durationMs: Date.now() - startedAt });
          } else {
            // CAS rejected — another worker owns it now.
            recordWorkerJob({ outcome: "aborted", attempts, durationMs: Date.now() - startedAt });
            logger.warn("complete CAS rejected (ownership lost)", { jobId: job.id });
          }
        }
      } catch (err) {
        // Ensure heartbeat is stopped.
        heartbeat?.stop();
        heartbeat = null;

        if (isAbort(err) || handlerAbort.signal.aborted) {
          if (signal?.aborted || ownershipLost) {
            // Global stop or heartbeat loss triggered the abort.
            if (signal?.aborted) {
              stats.stoppedBySignal = true;
              recordWorkerJob({ outcome: "aborted", attempts, durationMs: Date.now() - startedAt });
              break;
            }
            // Ownership lost via heartbeat abort — do not call fail.
            recordWorkerJob({ outcome: "aborted", attempts, durationMs: Date.now() - startedAt });
            logger.warn("handler aborted (ownership lost)", { jobId: job.id });
          } else {
            // AbortError from handler itself (no global signal, no heartbeat loss).
            // Treat as a stop signal (preserves old behavior).
            stats.stoppedBySignal = true;
            recordWorkerJob({ outcome: "aborted", attempts, durationMs: Date.now() - startedAt });
            break;
          }
        } else if (ownershipLost) {
          // Handler threw a real error but we lost ownership — cannot call fail.
          recordWorkerJob({ outcome: "aborted", attempts, durationMs: Date.now() - startedAt });
          logger.warn("handler error after ownership loss, skipping fail", { jobId: job.id });
        } else {
          const updated = await failFn(job.id, workerId, err);
          if (updated) {
            const deadLettered = updated.status === JobStatus.DEAD_LETTER;
            recordFailureStats(stats, deadLettered);
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
              error: errorMessage(err),
            });
          } else {
            // Fail CAS rejected — ownership lost during error handling.
            recordWorkerJob({ outcome: "aborted", attempts, durationMs: Date.now() - startedAt });
            logger.warn("fail CAS rejected (ownership lost)", { jobId: job.id });
          }
        }
      } finally {
        heartbeat?.stop();
        signal?.removeEventListener("abort", onGlobalAbort);
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
