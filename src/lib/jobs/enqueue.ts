/**
 * Job enqueue and idempotent dedupe logic (RW-013).
 */
import { prisma } from "@/lib/prisma";
import { Prisma, JobStatus, JobType, type Job } from "@prisma/client";
import { createLogger } from "@/lib/observability/logger";
import { recordJobQueueEvent } from "@/lib/metrics";
import { retryPolicyFor } from "./retry-policy";
import { ACTIVE_STATUSES, type JobPayload, type ArticleJobPayload, type ArticleIngestPayload, type PushReminderPayload } from "./types";
import {
  CANDIDATE_INGEST_PROCESSING_VERSION,
  buildCandidateIngestPayload,
  candidateIngestDedupeKey,
} from "./candidate-ingest";

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

type PendingJobBase = {
  maxAttempts: number;
  runAfter: Date;
  priority: number;
};

function hasToJson(value: object): value is { toJSON: () => unknown } {
  return "toJSON" in value && typeof value.toJSON === "function";
}

function isInputJsonValue(value: unknown): value is Prisma.InputJsonValue | null {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isInputJsonValue);
  if (typeof value !== "object") return false;
  if (hasToJson(value)) return true;
  return Object.values(value).every(isInputJsonValue);
}

function payloadInputJsonObject(payload: JobPayload): Prisma.InputJsonObject {
  const entries = Object.entries(payload);
  const normalized: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, value] of entries) {
    if (!isInputJsonValue(value)) {
      throw new Error(`Job payload field "${key}" is not JSON-serializable.`);
    }
    normalized[key] = value;
  }
  return normalized;
}

function emptyErrorHistory(): Prisma.InputJsonArray {
  return [];
}

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
    data: pendingJobData(type, payload, { maxAttempts, runAfter, priority }),
  });
  recordJobQueueEvent({ event: "enqueued", type });
  log.info("job enqueued", { jobId: job.id, type, priority });
  return job;
}

async function enqueueDeduped(
  type: JobType,
  payload: JobPayload,
  dedupeKey: string,
  base: PendingJobBase,
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
        payload: payloadInputJsonObject(payload),
        errorHistory: emptyErrorHistory(),
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
      data: pendingJobData(type, payload, base, dedupeKey),
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

function pendingJobData(
  type: JobType,
  payload: JobPayload,
  base: PendingJobBase,
  dedupeKey?: string,
) {
  return {
    type,
    status: JobStatus.PENDING,
    payload: payloadInputJsonObject(payload),
    errorHistory: emptyErrorHistory(),
    attempts: 0,
    maxAttempts: base.maxAttempts,
    priority: base.priority,
    runAfter: base.runAfter,
    ...(dedupeKey ? { dedupeKey } : {}),
  };
}

/**
 * Transaction-aware idempotent enqueue that participates in an EXISTING Prisma
 * interactive transaction (issue #1091). Unlike the standalone
 * {@link enqueueDeduped} — which runs on its own connection and can safely
 * catch a `P2002` — an enqueue INSIDE an interactive transaction MUST use
 * `upsert` (INSERT … ON CONFLICT): a caught `P2002` POISONS a PostgreSQL
 * transaction and aborts the whole page commit.
 *
 * The `update: {}` no-op is deliberate: an existing Job for this dedupe key —
 * ACTIVE or TERMINAL — is REUSED, never reset. Concurrent or replayed enqueues
 * of the same key therefore converge on the single database winner (upsert
 * returns it), and a terminal Job is never revived by ordinary rediscovery
 * (AC2/AC3). Preserves the type's retry policy, priority, run-after, and
 * empty-error-history initialization.
 *
 * No queue metric is emitted here: the surrounding transaction may still roll
 * back, so counting an "enqueued" event before commit would be incorrect.
 */
export function enqueueJobInTx(
  tx: Prisma.TransactionClient,
  type: JobType,
  payload: JobPayload,
  dedupeKey: string,
  opts: EnqueueOptions = {},
): Promise<Job> {
  const policy = retryPolicyFor(type);
  const maxAttempts = Math.max(1, opts.maxAttempts ?? policy.maxAttempts);
  const runAfter = opts.runAfter ?? new Date();
  const priority = opts.priority ?? 0;

  return tx.job.upsert({
    where: { dedupeKey },
    create: pendingJobData(type, payload, { maxAttempts, runAfter, priority }, dedupeKey),
    update: {},
  });
}

/**
 * Enqueues candidate-based ARTICLE_INGEST work for an ELIGIBLE new candidate,
 * INSIDE the caller's interactive transaction (the page-commit tx, #1091). The
 * payload carries ONLY `{ candidateId, processingVersion }` — never a URL,
 * provider policy, credential, or article data (AC4). Idempotent + terminal-Job
 * safe via {@link enqueueJobInTx}.
 */
export function enqueueCandidateIngestInTx(
  tx: Prisma.TransactionClient,
  candidateId: string,
  opts: EnqueueOptions = {},
): Promise<Job> {
  const processingVersion = CANDIDATE_INGEST_PROCESSING_VERSION;
  return enqueueJobInTx(
    tx,
    JobType.ARTICLE_INGEST,
    buildCandidateIngestPayload(candidateId, processingVersion),
    candidateIngestDedupeKey(candidateId, processingVersion),
    opts,
  );
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
