/**
 * Job enqueue and idempotent dedupe logic (RW-013).
 */
import { prisma } from "@/lib/prisma";
import { Prisma, JobStatus, JobType, type Job } from "@prisma/client";
import { createLogger } from "@/lib/observability/logger";
import { recordJobQueueEvent } from "@/lib/metrics";
import { retryPolicyFor } from "./retry-policy";
import { ACTIVE_STATUSES, type JobPayload, type ArticleJobPayload, type ArticleIngestPayload, type PushReminderPayload } from "./types";

export type { ArticleJobPayload, ArticleIngestPayload, PushReminderPayload, JobPayload };

const log = createLogger("jobs");

export type EnqueueOptions = {
  /** Override the job type's default attempt limit. */
  maxAttempts?: number;
  /** Earliest time the job becomes runnable. Defaults to now. */
  runAfter?: Date;
  /** Higher runs first among ready jobs. Defaults to 0. */
  priority?: number;
  /**
   * Idempotency key. At most one job per key exists; enqueuing again while an
   * active job exists returns it unchanged. A terminal job with the same key is
   * reset to PENDING (re-enqueued) with the new payload.
   */
  dedupeKey?: string;
};

/**
 * Persists a job. DB-backed, so it survives restarts. When `dedupeKey` is set
 * the operation is idempotent (see {@link EnqueueOptions.dedupeKey}).
 */
export async function enqueueJob(
  type: JobType,
  payload: JobPayload,
  opts: EnqueueOptions = {},
): Promise<Job> {
  const policy = retryPolicyFor(type);
  const maxAttempts = Math.max(1, opts.maxAttempts ?? policy.maxAttempts);
  const runAfter = opts.runAfter ?? new Date();
  const priority = opts.priority ?? 0;

  if (opts.dedupeKey) {
    return enqueueDeduped(type, payload, opts.dedupeKey, { maxAttempts, runAfter, priority });
  }

  const job = await prisma.job.create({
    data: {
      type,
      status: JobStatus.PENDING,
      payload: payload as Prisma.InputJsonValue,
      errorHistory: [] as unknown as Prisma.InputJsonValue,
      attempts: 0,
      maxAttempts,
      priority,
      runAfter,
    },
  });
  recordJobQueueEvent({ event: "enqueued", type });
  log.info("job enqueued", { jobId: job.id, type, priority });
  return job;
}

async function enqueueDeduped(
  type: JobType,
  payload: JobPayload,
  dedupeKey: string,
  base: { maxAttempts: number; runAfter: Date; priority: number },
): Promise<Job> {
  const existing = await prisma.job.findUnique({ where: { dedupeKey } });
  if (existing) {
    if (ACTIVE_STATUSES.includes(existing.status)) {
      return existing;
    }
    // Terminal job: re-enqueue by resetting it to PENDING with the new payload.
    const reset = await prisma.job.update({
      where: { id: existing.id },
      data: {
        type,
        status: JobStatus.PENDING,
        payload: payload as Prisma.InputJsonValue,
        errorHistory: [] as unknown as Prisma.InputJsonValue,
        attempts: 0,
        maxAttempts: base.maxAttempts,
        priority: base.priority,
        runAfter: base.runAfter,
        lastError: null,
        lockedBy: null,
        lockedAt: null,
        failedAt: null,
        deadLetteredAt: null,
        completedAt: null,
        startedAt: null,
      },
    });
    recordJobQueueEvent({ event: "enqueued", type });
    return reset;
  }

  try {
    const job = await prisma.job.create({
      data: {
        type,
        status: JobStatus.PENDING,
        payload: payload as Prisma.InputJsonValue,
        errorHistory: [] as unknown as Prisma.InputJsonValue,
        attempts: 0,
        maxAttempts: base.maxAttempts,
        priority: base.priority,
        runAfter: base.runAfter,
        dedupeKey,
      },
    });
    recordJobQueueEvent({ event: "enqueued", type });
    log.info("job enqueued", { jobId: job.id, type, dedupeKey });
    return job;
  } catch (err) {
    // Lost a race to another enqueue with the same key — return the winner.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await prisma.job.findUnique({ where: { dedupeKey } });
      if (winner) return winner;
    }
    throw err;
  }
}

export function enqueueArticleProcess(
  articleId: string,
  payload: Omit<ArticleJobPayload, "articleId"> = {},
  opts: EnqueueOptions = {},
): Promise<Job> {
  return enqueueJob(
    JobType.ARTICLE_PROCESS,
    { articleId, ...payload },
    { dedupeKey: `article-process:${articleId}`, ...opts },
  );
}

export function enqueueArticleIngest(
  payload: ArticleIngestPayload,
  opts: EnqueueOptions = {},
): Promise<Job> {
  const dedupeKey = payload.url ? `article-ingest:${payload.url}` : undefined;
  return enqueueJob(JobType.ARTICLE_INGEST, payload, { dedupeKey, ...opts });
}

export function enqueueAiRebuild(
  articleId: string,
  payload: Omit<ArticleJobPayload, "articleId"> = {},
  opts: EnqueueOptions = {},
): Promise<Job> {
  return enqueueJob(
    JobType.AI_REBUILD,
    { articleId, ...payload },
    { dedupeKey: `ai-rebuild:${articleId}`, ...opts },
  );
}

export function enqueueTtsGenerate(
  articleId: string,
  opts: EnqueueOptions = {},
): Promise<Job> {
  return enqueueJob(
    JobType.TTS_GENERATE,
    { articleId, tts: true },
    { dedupeKey: `tts-generate:${articleId}`, ...opts },
  );
}

export function enqueuePushReminder(
  payload: PushReminderPayload,
  opts: EnqueueOptions = {},
): Promise<Job> {
  return enqueueJob(JobType.PUSH_REMINDER, payload, opts);
}
