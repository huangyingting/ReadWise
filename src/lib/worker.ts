import {
  processArticle,
  type ProcessOptions,
} from "@/lib/processor";
import { createLogger } from "@/lib/logger";
import { recordWorkerJob } from "@/lib/metrics";
import { withSpan } from "@/lib/tracing";
import { captureError } from "@/lib/error-reporting";
import {
  claimNextJob,
  completeJob,
  failJob,
  startJob,
  JobError,
  JobStatus,
  JobType,
  type Job,
} from "@/lib/jobs";

export type WorkerLogger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

/** Default logger: structured JSON lines (scope "worker") via {@link createLogger}. */
export function createConsoleLogger(): WorkerLogger {
  return createLogger("worker");
}

class AbortError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

/** Resolves after `ms`, or rejects with AbortError if the signal aborts first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new AbortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

// ---------------------------------------------------------------------------
// Persistent job-table worker (RW-013/014/015)
// ---------------------------------------------------------------------------

/** Generates a stable-ish worker identity for lock ownership + tracing. */
export function generateWorkerId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `worker-${process.pid}-${rand}`;
}

/** Handles a single claimed job. Throw to fail it (JobError sets retry intent). */
export type JobHandler = (
  job: Job,
  ctx: { logger: WorkerLogger; signal?: AbortSignal; process?: ProcessOptions },
) => Promise<void>;

export type JobWorkerOptions = {
  /** Worker identity used for lock ownership. Defaults to a generated id. */
  workerId?: string;
  /** Idle wait between polls when no job is claimable (ms). Default 5000. */
  pollIntervalMs?: number;
  /** Lock lease length (ms) handed to claimNextJob. */
  lockTtlMs?: number;
  /** Restrict to specific job types. */
  types?: JobType[];
  /** Drain the queue once then stop (instead of polling forever). */
  once?: boolean;
  /** Cooperative stop signal. */
  signal?: AbortSignal;
  logger?: WorkerLogger;
  /** Override/extend the default per-type handlers. */
  handlers?: Partial<Record<JobType, JobHandler>>;
  /** Forwarded to processArticle for article jobs (e.g. tts / translateLangs). */
  process?: ProcessOptions;
  deps?: {
    claimNextJob?: typeof claimNextJob;
    startJob?: typeof startJob;
    completeJob?: typeof completeJob;
    failJob?: typeof failJob;
    processArticle?: typeof processArticle;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  };
};

export type JobWorkerStats = {
  polls: number;
  claimed: number;
  completed: number;
  failed: number;
  retried: number;
  deadLettered: number;
  stoppedBySignal: boolean;
};

/**
 * Builds a handler that enriches an article via the idempotent processor. A
 * missing article or a payload without `articleId` is a permanent failure
 * (dead-letter, not retried); a processor step failure is transient (retried).
 */
function makeArticleHandler(processFn: typeof processArticle): JobHandler {
  return async (job, ctx) => {
    const payload = (job.payload ?? {}) as {
      articleId?: string;
      tts?: boolean;
      translateLangs?: string[];
    };
    const articleId = payload.articleId;
    if (!articleId) {
      throw new JobError("job payload missing articleId", { kind: "validation" });
    }
    const result = await processFn(articleId, {
      tts: payload.tts ?? ctx.process?.tts,
      translateLangs: payload.translateLangs ?? ctx.process?.translateLangs,
    });
    if (result === null) {
      throw new JobError(`article ${articleId} not found`, { kind: "missing" });
    }
    if (!result.ok) {
      const failedSteps = result.steps
        .filter((s) => s.status === "failed")
        .map((s) => `${s.step}: ${s.detail ?? "unknown"}`)
        .join("; ");
      throw new JobError(`processing failed (${failedSteps || "unknown"})`, { kind: "provider" });
    }
    ctx.logger.info("article job processed", {
      jobId: job.id,
      articleId,
      published: result.published,
    });
  };
}

function defaultHandlers(processFn: typeof processArticle): Partial<Record<JobType, JobHandler>> {
  const articleHandler = makeArticleHandler(processFn);
  return {
    [JobType.ARTICLE_INGEST]: articleHandler,
    [JobType.ARTICLE_PROCESS]: articleHandler,
    [JobType.AI_REBUILD]: articleHandler,
    [JobType.TTS_GENERATE]: articleHandler,
    // PUSH_REMINDER has its own dedicated pipeline (scripts/push-reminders.ts);
    // a no-op handler here keeps unconfigured deployments from dead-lettering.
    [JobType.PUSH_REMINDER]: async (job, ctx) => {
      ctx.logger.info("push reminder job acknowledged (no-op handler)", { jobId: job.id });
    },
  };
}

/**
 * Long-running worker that drains the persistent `Job` table. Claims one job at
 * a time (locked so multiple workers never run the same job), runs its handler,
 * and completes or fails it. Resumes pending work automatically after a restart
 * because the DB is the source of truth. Pass an AbortSignal to stop safely.
 */
export async function runJobWorker(options: JobWorkerOptions = {}): Promise<JobWorkerStats> {
  const workerId = options.workerId ?? generateWorkerId();
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const logger = options.logger ?? createConsoleLogger();
  const signal = options.signal;
  const claimFn = options.deps?.claimNextJob ?? claimNextJob;
  const startFn = options.deps?.startJob ?? startJob;
  const completeFn = options.deps?.completeJob ?? completeJob;
  const failFn = options.deps?.failJob ?? failJob;
  const processFn = options.deps?.processArticle ?? processArticle;
  const sleepFn = options.deps?.sleep ?? sleep;
  const handlers = { ...defaultHandlers(processFn), ...options.handlers };

  const stats: JobWorkerStats = {
    polls: 0,
    claimed: 0,
    completed: 0,
    failed: 0,
    retried: 0,
    deadLettered: 0,
    stoppedBySignal: false,
  };

  logger.info("job worker started", {
    workerId,
    pollIntervalMs,
    once: Boolean(options.once),
    types: options.types ?? [],
  });

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
        const handler = handlers[job.type];
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
        // Dead-letter = exhausted retries => higher severity so it can alert.
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

  logger.info("job worker stopped", { ...stats });
  return stats;
}
