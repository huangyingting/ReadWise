import {
  listUnprocessedArticleIds,
  processArticle,
  type ArticleProcessResult,
  type ProcessOptions,
} from "@/lib/processor";
import { createLogger } from "@/lib/logger";
import { recordWorkerJob } from "@/lib/metrics";
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

export type WorkerOptions = {
  /** Idle wait between polls when the queue is empty (ms). Default 5000. */
  pollIntervalMs?: number;
  /** Max articles fetched (and processed) per poll. Default 5. */
  batchSize?: number;
  /** Retry attempts per article after the first failure. Default 3. */
  maxRetries?: number;
  /** Base delay for exponential backoff between retries (ms). Default 1000. */
  baseBackoffMs?: number;
  /** Cap on the backoff delay (ms). Default 30000. */
  maxBackoffMs?: number;
  /** Also pick up published articles that are missing enrichment. */
  includePublished?: boolean;
  /** Drain the queue once then stop (instead of polling forever). */
  once?: boolean;
  /**
   * How long (ms) to quarantine an article that permanently failed (exhausted
   * retries) so the DB-derived queue doesn't re-select and re-fail it forever.
   * Default 300000 (5 min). The id is skipped until the cooldown expires.
   */
  quarantineMs?: number;
  /** Forwarded to processArticle (e.g. tts / translateLangs). */
  process?: ProcessOptions;
  /** Cooperative stop signal — aborting it stops the worker safely. */
  signal?: AbortSignal;
  logger?: WorkerLogger;
  /** Injectable for testing (defaults to the real processor helpers). */
  deps?: {
    listUnprocessedArticleIds?: typeof listUnprocessedArticleIds;
    processArticle?: typeof processArticle;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  };
};

export type WorkerStats = {
  polls: number;
  processed: number;
  published: number;
  failed: number;
  retried: number;
  /** Count of articles quarantined this run after exhausting retries. */
  quarantined: number;
  stoppedBySignal: boolean;
};

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

/**
 * Processes a single article with bounded retries and exponential backoff.
 * A failure is either a thrown error or a result whose `ok` is false (a step
 * failed). Returns the final result (which may still be `ok:false`) or null
 * when the article no longer exists.
 */
async function processWithRetry(
  articleId: string,
  opts: Required<Pick<WorkerOptions, "maxRetries" | "baseBackoffMs" | "maxBackoffMs">> & {
    process?: ProcessOptions;
    logger: WorkerLogger;
    signal?: AbortSignal;
    processArticleFn: typeof processArticle;
    sleepFn: (ms: number, signal?: AbortSignal) => Promise<void>;
  },
): Promise<{ result: ArticleProcessResult | null; attempts: number }> {
  let attempt = 0;
  // total tries = 1 + maxRetries
  for (;;) {
    if (opts.signal?.aborted) throw new AbortError();
    attempt++;
    try {
      const result = await opts.processArticleFn(articleId, opts.process);
      if (result === null) {
        return { result: null, attempts: attempt };
      }
      if (result.ok) {
        return { result, attempts: attempt };
      }
      const failedSteps = result.steps
        .filter((s) => s.status === "failed")
        .map((s) => `${s.step}: ${s.detail ?? "unknown"}`)
        .join("; ");
      if (attempt > opts.maxRetries) {
        opts.logger.error("article failed after retries", {
          articleId,
          attempts: attempt,
          failedSteps,
        });
        return { result, attempts: attempt };
      }
      const delay = backoffDelay(attempt, opts.baseBackoffMs, opts.maxBackoffMs);
      opts.logger.warn("article had failed steps, retrying", {
        articleId,
        attempt,
        nextRetryInMs: delay,
        failedSteps,
      });
      await opts.sleepFn(delay, opts.signal);
    } catch (err) {
      if (isAbort(err)) throw err;
      if (attempt > opts.maxRetries) {
        opts.logger.error("article threw after retries", {
          articleId,
          attempts: attempt,
          error: err instanceof Error ? err.message : String(err),
        });
        return { result: null, attempts: attempt };
      }
      const delay = backoffDelay(attempt, opts.baseBackoffMs, opts.maxBackoffMs);
      opts.logger.warn("article threw, retrying", {
        articleId,
        attempt,
        nextRetryInMs: delay,
        error: err instanceof Error ? err.message : String(err),
      });
      await opts.sleepFn(delay, opts.signal);
    }
  }
}

/** Exponential backoff with jitter, capped at maxBackoffMs. */
export function backoffDelay(attempt: number, base: number, max: number): number {
  const exp = Math.min(max, base * 2 ** (attempt - 1));
  const jitter = Math.floor(Math.random() * Math.min(base, exp));
  return Math.min(max, exp + jitter);
}

/**
 * Long-running background worker. Continuously polls the article queue and
 * enriches drafts (difficulty/tags/vocab/quiz, optional translation + TTS) via
 * the idempotent processor, retrying transient failures with backoff. Because
 * the processor is cache-first and the queue is the source of truth, the worker
 * resumes pending work automatically after a restart. Pass an AbortSignal to
 * stop it safely between articles; in-flight work finishes (or aborts cleanly
 * during a backoff sleep) and the function resolves with run stats.
 */
export async function runWorker(options: WorkerOptions = {}): Promise<WorkerStats> {
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const batchSize = Math.max(1, options.batchSize ?? 5);
  const maxRetries = Math.max(0, options.maxRetries ?? 3);
  const baseBackoffMs = Math.max(0, options.baseBackoffMs ?? 1000);
  const maxBackoffMs = Math.max(baseBackoffMs, options.maxBackoffMs ?? 30000);
  const quarantineMs = Math.max(0, options.quarantineMs ?? 300000);
  const logger = options.logger ?? createConsoleLogger();
  const signal = options.signal;
  const listFn = options.deps?.listUnprocessedArticleIds ?? listUnprocessedArticleIds;
  const processFn = options.deps?.processArticle ?? processArticle;
  const sleepFn = options.deps?.sleep ?? sleep;

  // In-memory poison-message quarantine: articleId -> timestamp (ms) until which
  // the id is skipped. A permanently-failing article (exhausted retries) is the
  // queue's source of truth, so without this the poll loop re-selects and
  // re-fails it on every poll forever. Entries expire so a transiently-broken
  // article gets retried again later.
  const quarantineUntil = new Map<string, number>();
  const isQuarantined = (id: string, nowMs: number): boolean => {
    const until = quarantineUntil.get(id);
    if (until === undefined) return false;
    if (nowMs >= until) {
      quarantineUntil.delete(id);
      return false;
    }
    return true;
  };

  const stats: WorkerStats = {
    polls: 0,
    processed: 0,
    published: 0,
    failed: 0,
    retried: 0,
    quarantined: 0,
    stoppedBySignal: false,
  };

  logger.info("worker started", {
    pollIntervalMs,
    batchSize,
    maxRetries,
    once: Boolean(options.once),
    includePublished: Boolean(options.includePublished),
    tts: Boolean(options.process?.tts),
    translateLangs: options.process?.translateLangs ?? [],
  });

  try {
    for (;;) {
      if (signal?.aborted) {
        stats.stoppedBySignal = true;
        break;
      }

      stats.polls++;
      const ids = await listFn({
        includePublished: options.includePublished,
        limit: batchSize,
      });

      const now = Date.now();
      const processable = ids.filter((id) => !isQuarantined(id, now));

      if (processable.length === 0) {
        if (options.once) {
          // Either the queue is empty or everything left is quarantined; in
          // once mode there is no more progress to make, so stop.
          logger.info(
            ids.length === 0
              ? "queue drained, stopping (once mode)"
              : "remaining articles are quarantined, stopping (once mode)",
          );
          break;
        }
        await sleepFn(pollIntervalMs, signal);
        continue;
      }

      logger.info("processing batch", { count: processable.length });

      for (const id of processable) {
        if (signal?.aborted) {
          stats.stoppedBySignal = true;
          break;
        }
        const jobStartedAt = Date.now();
        let result: ArticleProcessResult | null;
        let attempts: number;
        try {
          ({ result, attempts } = await processWithRetry(id, {
            maxRetries,
            baseBackoffMs,
            maxBackoffMs,
            process: options.process,
            logger,
            signal,
            processArticleFn: processFn,
            sleepFn,
          }));
        } catch (err) {
          if (isAbort(err)) {
            recordWorkerJob({
              outcome: "aborted",
              attempts: 1,
              durationMs: Date.now() - jobStartedAt,
            });
          }
          throw err;
        }
        if (attempts > 1) stats.retried++;
        if (result === null) {
          recordWorkerJob({
            outcome: "missing",
            attempts,
            durationMs: Date.now() - jobStartedAt,
          });
          logger.warn("article skipped (missing or unrecoverable)", { articleId: id, attempts });
          stats.failed++;
          quarantineUntil.set(id, Date.now() + quarantineMs);
          stats.quarantined++;
          continue;
        }
        stats.processed++;
        if (result.published) stats.published++;
        if (!result.ok) {
          recordWorkerJob({
            outcome: "failed",
            attempts,
            published: result.published,
            durationMs: Date.now() - jobStartedAt,
          });
          stats.failed++;
          quarantineUntil.set(id, Date.now() + quarantineMs);
          stats.quarantined++;
          continue;
        }
        recordWorkerJob({
          outcome: "success",
          attempts,
          published: result.published,
          durationMs: Date.now() - jobStartedAt,
        });
        logger.info("article processed", {
          articleId: id,
          published: result.published,
          attempts,
        });
      }

      if (stats.stoppedBySignal) break;
    }
  } catch (err) {
    if (isAbort(err)) {
      stats.stoppedBySignal = true;
    } else {
      logger.error("worker loop crashed", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  logger.info("worker stopped", { ...stats });
  return stats;
}

// ---------------------------------------------------------------------------
// Persistent job-table worker (RW-013/014/015)
// ---------------------------------------------------------------------------
//
// The article-derived `runWorker` above remains the default (`npm run worker`).
// `runJobWorker` is the DB-backed alternative: it claims rows from the `Job`
// table (safe under concurrency via claimNextJob's locking), runs a type-keyed
// handler, then marks the job COMPLETED or FAILED. Retry/backoff/dead-letter
// policy lives in `failJob`, so this loop stays thin. The processor stays
// idempotent (cache-first) as a second line of defense against duplicate work.

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
        await handler(job, { logger, signal, process: options.process });
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
        if (updated?.status === JobStatus.DEAD_LETTER) {
          stats.deadLettered++;
        } else {
          stats.retried++;
        }
        recordWorkerJob({ outcome: "failed", attempts, durationMs: Date.now() - startedAt });
        logger.warn("job handler failed", {
          jobId: job.id,
          type: job.type,
          deadLettered: updated?.status === JobStatus.DEAD_LETTER,
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
