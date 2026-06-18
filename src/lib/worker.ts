import {
  listUnprocessedArticleIds,
  processArticle,
  type ArticleProcessResult,
  type ProcessOptions,
} from "@/lib/processor";

export type WorkerLogger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

/** Default logger: timestamped, level-prefixed lines on the console. */
export function createConsoleLogger(): WorkerLogger {
  const fmt = (level: string, message: string, meta?: Record<string, unknown>) => {
    const ts = new Date().toISOString();
    const extra = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${ts} [worker] ${level} ${message}${extra}`;
  };
  return {
    info: (m, meta) => console.log(fmt("INFO", m, meta)),
    warn: (m, meta) => console.warn(fmt("WARN", m, meta)),
    error: (m, meta) => console.error(fmt("ERROR", m, meta)),
  };
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
  const logger = options.logger ?? createConsoleLogger();
  const signal = options.signal;
  const listFn = options.deps?.listUnprocessedArticleIds ?? listUnprocessedArticleIds;
  const processFn = options.deps?.processArticle ?? processArticle;
  const sleepFn = options.deps?.sleep ?? sleep;

  const stats: WorkerStats = {
    polls: 0,
    processed: 0,
    published: 0,
    failed: 0,
    retried: 0,
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

      if (ids.length === 0) {
        if (options.once) {
          logger.info("queue drained, stopping (once mode)");
          break;
        }
        await sleepFn(pollIntervalMs, signal);
        continue;
      }

      logger.info("processing batch", { count: ids.length });

      for (const id of ids) {
        if (signal?.aborted) {
          stats.stoppedBySignal = true;
          break;
        }
        const { result, attempts } = await processWithRetry(id, {
          maxRetries,
          baseBackoffMs,
          maxBackoffMs,
          process: options.process,
          logger,
          signal,
          processArticleFn: processFn,
          sleepFn,
        });
        if (attempts > 1) stats.retried++;
        if (result === null) {
          logger.warn("article skipped (missing or unrecoverable)", { articleId: id, attempts });
          stats.failed++;
          continue;
        }
        stats.processed++;
        if (result.published) stats.published++;
        if (!result.ok) {
          stats.failed++;
          continue;
        }
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
