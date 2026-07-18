import { captureError } from "@/lib/observability/errors";
import { recordWorkerJob } from "@/lib/metrics";
import { withSpan } from "@/lib/observability/tracing";
import {
  completeJob,
  DEFAULT_LOCK_TTL_MS,
  failJob,
  heartbeatJob,
  JobError,
  JobStatus,
  startJob,
  type Job,
  type JobType,
} from "@/lib/jobs";
import type { ProcessOptions } from "@/lib/processing/processor";
import { isAbort } from "./sleep";
import type { JobHandler, WorkerLogger } from "./types";

export type ClaimedJobExecutionResult =
  | { outcome: "completed" }
  | { outcome: "failed"; deadLettered: boolean }
  | { outcome: "aborted" }
  | { outcome: "skipped" }
  | { outcome: "stopped" };

export type ClaimedJobExecutor = (job: Job) => Promise<ClaimedJobExecutionResult>;

export type ClaimedJobExecutorOptions = {
  workerId: string;
  handlers: Partial<Record<JobType, JobHandler>>;
  logger: WorkerLogger;
  lockTtlMs?: number;
  heartbeatIntervalMs?: number;
  signal?: AbortSignal;
  process?: ProcessOptions;
};

export type ClaimedJobExecutionDeps = {
  startJob?: typeof startJob;
  heartbeatJob?: typeof heartbeatJob;
  completeJob?: typeof completeJob;
  failJob?: typeof failJob;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultHeartbeatIntervalMs(lockTtlMs: number): number {
  return Math.max(1000, Math.floor(lockTtlMs / 2));
}

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
      const owned = await heartbeatFn(jobId, workerId);
      if (!owned) {
        logger.warn("heartbeat ownership lost", { jobId, workerId });
        if (!handlerAbort.signal.aborted) {
          handlerAbort.abort();
        }
        return;
      }
    } catch (error) {
      logger.warn("heartbeat error", { jobId, workerId, error: errorMessage(error) });
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

export function createClaimedJobExecutor(
  options: ClaimedJobExecutorOptions,
  deps: ClaimedJobExecutionDeps = {},
): ClaimedJobExecutor {
  const startFn = deps.startJob ?? startJob;
  const heartbeatFn = deps.heartbeatJob ?? heartbeatJob;
  const completeFn = deps.completeJob ?? completeJob;
  const failFn = deps.failJob ?? failJob;
  const intervalMs = options.heartbeatIntervalMs
    ?? defaultHeartbeatIntervalMs(options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS);

  return async (job) => {
    const attempts = job.attempts + 1;
    const startedAt = Date.now();
    const handlerAbort = new AbortController();
    let ownershipLost = false;

    const onGlobalAbort = () => {
      if (!handlerAbort.signal.aborted) handlerAbort.abort();
    };
    options.signal?.addEventListener("abort", onGlobalAbort, { once: true });

    const onHandlerAbort = () => {
      if (!options.signal?.aborted) ownershipLost = true;
    };
    handlerAbort.signal.addEventListener("abort", onHandlerAbort, { once: true });

    let heartbeat: { stop: () => void } | null = null;

    try {
      const started = await startFn(job.id, options.workerId);
      if (!started) {
        return { outcome: "skipped" };
      }

      const handler = options.handlers[job.type as JobType];
      if (!handler) {
        throw new JobError(`no handler registered for job type ${job.type}`, {
          kind: "validation",
        });
      }

      heartbeat = startHeartbeat(
        job.id,
        options.workerId,
        intervalMs,
        handlerAbort,
        heartbeatFn,
        options.logger,
      );

      await withSpan(
        "worker.job",
        { "readwise.job_type": job.type, "readwise.attempt": attempts },
        () => handler(job, {
          logger: options.logger,
          signal: handlerAbort.signal,
          process: options.process,
        }),
      );

      heartbeat.stop();
      heartbeat = null;

      if (ownershipLost) {
        recordWorkerJob({ outcome: "aborted", attempts, durationMs: Date.now() - startedAt });
        options.logger.warn("handler completed after ownership loss, skipping complete", {
          jobId: job.id,
        });
        return { outcome: "aborted" };
      }

      const completed = await completeFn(job.id, options.workerId);
      if (completed) {
        recordWorkerJob({ outcome: "success", attempts, durationMs: Date.now() - startedAt });
        return { outcome: "completed" };
      }

      recordWorkerJob({ outcome: "aborted", attempts, durationMs: Date.now() - startedAt });
      options.logger.warn("complete CAS rejected (ownership lost)", { jobId: job.id });
      return { outcome: "aborted" };
    } catch (error) {
      heartbeat?.stop();
      heartbeat = null;

      if (ownershipLost) {
        recordWorkerJob({ outcome: "aborted", attempts, durationMs: Date.now() - startedAt });
        if (options.signal?.aborted) {
          return { outcome: "stopped" };
        }
        if (isAbort(error)) {
          options.logger.warn("handler aborted (ownership lost)", { jobId: job.id });
        } else {
          options.logger.warn("handler error after ownership loss, skipping fail", { jobId: job.id });
        }
        return { outcome: "aborted" };
      }

      if (isAbort(error) || handlerAbort.signal.aborted) {
        recordWorkerJob({ outcome: "aborted", attempts, durationMs: Date.now() - startedAt });
        return { outcome: "stopped" };
      }

      const updated = await failFn(job.id, options.workerId, error);
      if (!updated) {
        recordWorkerJob({ outcome: "aborted", attempts, durationMs: Date.now() - startedAt });
        options.logger.warn("fail CAS rejected (ownership lost)", { jobId: job.id });
        return { outcome: "aborted" };
      }

      const deadLettered = updated.status === JobStatus.DEAD_LETTER;
      recordWorkerJob({ outcome: "failed", attempts, durationMs: Date.now() - startedAt });
      captureError(error, {
        source: "worker",
        severity: deadLettered ? "fatal" : "warning",
        extra: { jobId: job.id, jobType: job.type, attempts, deadLettered },
      });
      options.logger.warn("job handler failed", {
        jobId: job.id,
        type: job.type,
        deadLettered,
        error: errorMessage(error),
      });
      return { outcome: "failed", deadLettered };
    } finally {
      heartbeat?.stop();
      options.signal?.removeEventListener("abort", onGlobalAbort);
    }
  };
}