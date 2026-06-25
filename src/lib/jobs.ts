/**
 * Durable background-job queue (RW-013/014/015).
 *
 * The worker historically derived its queue from article state and kept poison
 * messages in an in-memory quarantine — fragile across restarts and unsafe with
 * multiple workers. This module backs the queue with the persistent `Job` table:
 *
 *   - RW-013: jobs survive restarts; status/attempts/lastError are visible in the DB.
 *   - RW-014: `claimNextJob` atomically claims one runnable job. On PostgreSQL it
 *     uses `FOR UPDATE SKIP LOCKED` so two workers can never claim the same row;
 *     on SQLite (tests/dev) it falls back to a serialized select-then-guarded-update.
 *     Stale locks (a CLAIMED/RUNNING job whose `lockedAt` is older than the lock
 *     TTL) are reclaimable so a crashed worker never strands a job.
 *   - RW-015: per-job-type retry policy with exponential backoff (preserving the
 *     worker's existing backoff semantics, now persisted). Transient failures are
 *     retried; permanent failures (missing article / validation / permission) and
 *     exhausted attempts move to DEAD_LETTER with `lastError` + `errorHistory`.
 *
 * The AI processing helpers stay idempotent (cache-first) as a second line of
 * defense against duplicate work.
 */
import { prisma } from "@/lib/prisma";
import { Prisma, JobStatus, JobType, type Job } from "@prisma/client";
import { createLogger } from "@/lib/logger";
import { recordJobLockAge, recordJobQueueEvent } from "@/lib/metrics";
import { jitteredExponentialBackoff } from "@/lib/backoff";

export { JobStatus, JobType };
export type { Job };

const log = createLogger("jobs");

/** Statuses a job can be claimed from when its `runAfter` gate has elapsed. */
export const RUNNABLE_STATUSES: JobStatus[] = [JobStatus.PENDING, JobStatus.FAILED];
/** Statuses whose lock can be stolen once it goes stale (crashed worker recovery). */
export const RECLAIMABLE_STATUSES: JobStatus[] = [JobStatus.CLAIMED, JobStatus.RUNNING];
/** Non-terminal statuses (an active/pending job exists for this dedupe key). */
export const ACTIVE_STATUSES: JobStatus[] = [
  JobStatus.PENDING,
  JobStatus.CLAIMED,
  JobStatus.RUNNING,
  JobStatus.FAILED,
];
/** Terminal statuses (no further automatic processing). */
export const TERMINAL_STATUSES: JobStatus[] = [JobStatus.COMPLETED, JobStatus.DEAD_LETTER];

/** Default lock lease (ms). A lock older than this is considered stale. */
export const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000;
/** How many error-history entries to retain (bounded growth). */
const MAX_ERROR_HISTORY = 25;

// ---------------------------------------------------------------------------
// Retry policy (RW-015)
// ---------------------------------------------------------------------------

export type RetryPolicy = {
  /** Total attempts allowed before dead-lettering (1 = no retries). */
  maxAttempts: number;
  /** Base delay for exponential backoff between retries (ms). */
  baseBackoffMs: number;
  /** Cap on the backoff delay (ms). */
  maxBackoffMs: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseBackoffMs: 1000,
  maxBackoffMs: 5 * 60 * 1000,
};

/** Per-job-type retry policies. Tunes attempt limits + backoff per workload. */
export const RETRY_POLICIES: Record<JobType, RetryPolicy> = {
  [JobType.ARTICLE_INGEST]: { maxAttempts: 5, baseBackoffMs: 2000, maxBackoffMs: 5 * 60 * 1000 },
  [JobType.ARTICLE_PROCESS]: { maxAttempts: 5, baseBackoffMs: 2000, maxBackoffMs: 5 * 60 * 1000 },
  [JobType.AI_REBUILD]: { maxAttempts: 4, baseBackoffMs: 5000, maxBackoffMs: 10 * 60 * 1000 },
  [JobType.TTS_GENERATE]: { maxAttempts: 3, baseBackoffMs: 5000, maxBackoffMs: 10 * 60 * 1000 },
  [JobType.PUSH_REMINDER]: { maxAttempts: 3, baseBackoffMs: 1000, maxBackoffMs: 60 * 1000 },
};

export function retryPolicyFor(type: JobType): RetryPolicy {
  return RETRY_POLICIES[type] ?? DEFAULT_RETRY_POLICY;
}

/**
 * Exponential backoff with jitter, capped at `max`. Mirrors the semantics of
 * `backoffDelay` in `src/lib/worker.ts` (now applied to persisted state).
 */
export function jobBackoffDelay(attempt: number, base: number, max: number): number {
  return jitteredExponentialBackoff({ attempt, baseMs: base, maxMs: max });
}

// ---------------------------------------------------------------------------
// Error classification (RW-015)
// ---------------------------------------------------------------------------

export type JobErrorKind = "provider" | "validation" | "missing" | "permission" | "unknown";

/**
 * Error carrying retry intent. `permanent` permanent failures skip retries and
 * go straight to DEAD_LETTER. By default validation / missing / permission
 * failures are permanent; provider/unknown failures are transient (retryable).
 */
export class JobError extends Error {
  readonly kind: JobErrorKind;
  readonly permanent: boolean;
  constructor(message: string, opts: { kind?: JobErrorKind; permanent?: boolean } = {}) {
    super(message);
    this.name = "JobError";
    this.kind = opts.kind ?? "unknown";
    this.permanent =
      opts.permanent ??
      (this.kind === "validation" || this.kind === "missing" || this.kind === "permission");
  }
}

export type ClassifiedError = { kind: JobErrorKind; permanent: boolean; message: string };

/** Classifies an arbitrary error. Unknown errors are treated as transient. */
export function classifyJobError(err: unknown): ClassifiedError {
  if (err instanceof JobError) {
    return { kind: err.kind, permanent: err.permanent, message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { kind: "provider", permanent: false, message };
}

// ---------------------------------------------------------------------------
// Payloads + enqueue helpers (RW-013)
// ---------------------------------------------------------------------------

export type ArticleJobPayload = {
  articleId: string;
  tts?: boolean;
  translateLangs?: string[];
};

export type ArticleIngestPayload = {
  url?: string;
  provider?: string;
  ownerId?: string;
} & Record<string, unknown>;

export type PushReminderPayload = {
  userId?: string;
} & Record<string, unknown>;

export type JobPayload = Record<string, unknown>;

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
    const job = await enqueueDeduped(type, payload, opts.dedupeKey, {
      maxAttempts,
      runAfter,
      priority,
    });
    return job;
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
      // An active job already covers this work — return it unchanged.
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

// ---------------------------------------------------------------------------
// Claiming with locking + stale recovery (RW-014)
// ---------------------------------------------------------------------------

export type ClaimOptions = {
  /** Restrict to specific job types. */
  types?: JobType[];
  /** Lock lease length (ms). Older locks are treated as stale. */
  lockTtlMs?: number;
  /** Override "now" (testing). */
  now?: Date;
};

function isPostgres(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

/**
 * Atomically claims one runnable job for `workerId`, marking it CLAIMED with a
 * fresh lock. Returns null when nothing is runnable. Safe under concurrency:
 * PostgreSQL uses `FOR UPDATE SKIP LOCKED`; other providers use a serialized
 * transaction with a guarded conditional update.
 */
export async function claimNextJob(workerId: string, opts: ClaimOptions = {}): Promise<Job | null> {
  const now = opts.now ?? new Date();
  const lockTtlMs = opts.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  const staleBefore = new Date(now.getTime() - lockTtlMs);

  const job = isPostgres()
    ? await claimNextJobPostgres(workerId, now, staleBefore, opts.types)
    : await claimNextJobGeneric(workerId, now, staleBefore, opts.types);

  if (!job) return null;
  recordJobQueueEvent({ event: "claimed", type: job.type });
  return job;
}

async function claimNextJobPostgres(
  workerId: string,
  now: Date,
  staleBefore: Date,
  types?: JobType[],
): Promise<Job | null> {
  // Enum labels are inlined as string literals (constants, not user input) so
  // PostgreSQL resolves them to the native enum type; dynamic values are bound.
  const typeFilter =
    types && types.length > 0
      ? Prisma.sql`AND "type" IN (${Prisma.join(types.map((t) => Prisma.sql`${t}::"JobType"`))})`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{ id: string; wasStale: boolean; lockedAt: Date | null }>>(Prisma.sql`
    UPDATE "Job" AS j SET
      "status" = 'CLAIMED'::"JobStatus",
      "lockedBy" = ${workerId},
      "lockedAt" = ${now},
      "updatedAt" = ${now}
    FROM (
      SELECT "id", "status", "lockedAt"
      FROM "Job"
      WHERE (
        ("status" IN ('PENDING'::"JobStatus", 'FAILED'::"JobStatus") AND "runAfter" <= ${now})
        OR ("status" IN ('CLAIMED'::"JobStatus", 'RUNNING'::"JobStatus") AND "lockedAt" < ${staleBefore})
      )
      ${typeFilter}
      ORDER BY "priority" DESC, "runAfter" ASC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    ) AS picked
    WHERE j."id" = picked."id"
    RETURNING j."id" AS "id",
      (picked."status" IN ('CLAIMED'::"JobStatus", 'RUNNING'::"JobStatus")) AS "wasStale",
      picked."lockedAt" AS "lockedAt"
  `);

  if (rows.length === 0) return null;
  const { id, wasStale, lockedAt } = rows[0];
  const job = await prisma.job.findUnique({ where: { id } });
  if (job && wasStale) {
    const ageMs = lockedAt ? now.getTime() - new Date(lockedAt).getTime() : 0;
    recordJobLockAge(job.type, Math.max(0, ageMs));
    recordJobQueueEvent({ event: "stale_reclaimed", type: job.type });
    log.warn("recovered stale job lock", { jobId: id, type: job.type, lockAgeMs: ageMs });
  }
  return job;
}

async function claimNextJobGeneric(
  workerId: string,
  now: Date,
  staleBefore: Date,
  types?: JobType[],
): Promise<Job | null> {
  const runnableWhere: Prisma.JobWhereInput = {
    OR: [
      { status: { in: RUNNABLE_STATUSES }, runAfter: { lte: now } },
      { status: { in: RECLAIMABLE_STATUSES }, lockedAt: { lt: staleBefore } },
    ],
    ...(types && types.length > 0 ? { type: { in: types } } : {}),
  };

  return prisma.$transaction(async (tx) => {
    const candidate = await tx.job.findFirst({
      where: runnableWhere,
      orderBy: [{ priority: "desc" }, { runAfter: "asc" }, { createdAt: "asc" }],
    });
    if (!candidate) return null;

    // Guarded update: only succeeds if the row is still claimable, so two
    // transactions that read the same candidate cannot both win.
    const updated = await tx.job.updateMany({
      where: { id: candidate.id, ...runnableWhere },
      data: { status: JobStatus.CLAIMED, lockedBy: workerId, lockedAt: now, updatedAt: now },
    });
    if (updated.count === 0) return null;

    if (RECLAIMABLE_STATUSES.includes(candidate.status)) {
      const ageMs = candidate.lockedAt ? now.getTime() - candidate.lockedAt.getTime() : 0;
      recordJobLockAge(candidate.type, Math.max(0, ageMs));
      recordJobQueueEvent({ event: "stale_reclaimed", type: candidate.type });
      log.warn("recovered stale job lock", { jobId: candidate.id, type: candidate.type, lockAgeMs: ageMs });
    }

    return tx.job.findUnique({ where: { id: candidate.id } });
  });
}

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

export type TransitionOptions = { now?: Date };

/** Marks a claimed job as RUNNING and refreshes its lock (heartbeat anchor). */
export async function startJob(
  jobId: string,
  workerId: string,
  opts: TransitionOptions = {},
): Promise<Job | null> {
  const now = opts.now ?? new Date();
  try {
    return await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.RUNNING,
        lockedBy: workerId,
        lockedAt: now,
        startedAt: now,
        updatedAt: now,
      },
    });
  } catch {
    return null;
  }
}

/** Refreshes a job's lock so a long-running task is not reclaimed as stale. */
export async function heartbeatJob(
  jobId: string,
  workerId: string,
  opts: TransitionOptions = {},
): Promise<boolean> {
  const now = opts.now ?? new Date();
  const res = await prisma.job.updateMany({
    where: { id: jobId, lockedBy: workerId },
    data: { lockedAt: now, updatedAt: now },
  });
  return res.count > 0;
}

/** Marks a job COMPLETED and releases its lock. */
export async function completeJob(jobId: string, opts: TransitionOptions = {}): Promise<Job | null> {
  const now = opts.now ?? new Date();
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return null;
  const done = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.COMPLETED,
      completedAt: now,
      lockedBy: null,
      lockedAt: null,
      lastError: null,
      updatedAt: now,
    },
  });
  recordJobQueueEvent({ event: "completed", type: job.type });
  return done;
}

export type FailJobOptions = {
  /** Force permanent failure (straight to DEAD_LETTER) regardless of classification. */
  permanent?: boolean;
  /** Override the retry policy backoff for this failure. */
  backoff?: Partial<RetryPolicy>;
  now?: Date;
};

/**
 * Records a job failure (RW-015). Increments `attempts`, appends to
 * `errorHistory`, and either schedules a retry (status FAILED, `runAfter` =
 * now + backoff) or — when the failure is permanent or attempts are exhausted —
 * moves the job to DEAD_LETTER with `lastError` preserved.
 */
export async function failJob(
  jobId: string,
  error: unknown,
  opts: FailJobOptions = {},
): Promise<Job | null> {
  const now = opts.now ?? new Date();
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return null;

  const policy = { ...retryPolicyFor(job.type), ...stripUndefined(opts.backoff ?? {}) };
  const classified = classifyJobError(error);
  const permanent = opts.permanent ?? classified.permanent;
  const attempts = job.attempts + 1;
  const errorHistory = appendErrorHistory(job.errorHistory, {
    at: now.toISOString(),
    attempt: attempts,
    kind: classified.kind,
    message: classified.message,
  });
  const exhausted = attempts >= job.maxAttempts;

  if (permanent || exhausted) {
    const dead = await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.DEAD_LETTER,
        attempts,
        lastError: classified.message,
        errorHistory: errorHistory as unknown as Prisma.InputJsonValue,
        failedAt: now,
        deadLetteredAt: now,
        lockedBy: null,
        lockedAt: null,
        updatedAt: now,
      },
    });
    recordJobQueueEvent({ event: "dead_letter", type: job.type });
    log.error("job dead-lettered", {
      jobId,
      type: job.type,
      attempts,
      reason: permanent ? `permanent:${classified.kind}` : "attempts_exhausted",
      lastError: classified.message,
    });
    return dead;
  }

  const delay = jobBackoffDelay(attempts, policy.baseBackoffMs, policy.maxBackoffMs);
  const failed = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.FAILED,
      attempts,
      lastError: classified.message,
      errorHistory: errorHistory as unknown as Prisma.InputJsonValue,
      runAfter: new Date(now.getTime() + delay),
      failedAt: now,
      lockedBy: null,
      lockedAt: null,
      updatedAt: now,
    },
  });
  recordJobQueueEvent({ event: "retry", type: job.type });
  log.warn("job failed, scheduled retry", {
    jobId,
    type: job.type,
    attempt: attempts,
    nextRetryInMs: delay,
    error: classified.message,
  });
  return failed;
}

// ---------------------------------------------------------------------------
// Admin / introspection helpers (RW-015)
// ---------------------------------------------------------------------------

/**
 * Re-queues a failed or dead-lettered job: resets it to PENDING, clears attempts
 * and error state, and makes it immediately runnable.
 */
export async function retryJob(jobId: string, opts: TransitionOptions = {}): Promise<Job | null> {
  const now = opts.now ?? new Date();
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return null;
  return prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.PENDING,
      attempts: 0,
      runAfter: now,
      lastError: null,
      lockedBy: null,
      lockedAt: null,
      failedAt: null,
      deadLetteredAt: null,
      completedAt: null,
      startedAt: null,
      updatedAt: now,
    },
  });
}

/** Cancels a job by moving it to DEAD_LETTER with a reason (admin action). */
export async function cancelJob(
  jobId: string,
  opts: TransitionOptions & { reason?: string } = {},
): Promise<Job | null> {
  const now = opts.now ?? new Date();
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return null;
  return prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.DEAD_LETTER,
      lastError: opts.reason ?? "cancelled by admin",
      deadLetteredAt: now,
      lockedBy: null,
      lockedAt: null,
      updatedAt: now,
    },
  });
}

/**
 * Permanently removes a job row (admin action). Only safe on TERMINAL jobs
 * (COMPLETED / DEAD_LETTER) — archiving an in-flight or pending job would let
 * the worker keep running it without a record, so callers must guard against
 * that. Returns the deleted job, or null when the job does not exist.
 */
export async function archiveJob(jobId: string): Promise<Job | null> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return null;
  await prisma.job.delete({ where: { id: jobId } });
  return job;
}

export type ListJobsFilter = {
  status?: JobStatus | JobStatus[];
  type?: JobType | JobType[];
  take?: number;
  skip?: number;
};

export function listJobs(filter: ListJobsFilter = {}): Promise<Job[]> {
  const where: Prisma.JobWhereInput = {};
  if (filter.status) where.status = Array.isArray(filter.status) ? { in: filter.status } : filter.status;
  if (filter.type) where.type = Array.isArray(filter.type) ? { in: filter.type } : filter.type;
  return prisma.job.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: filter.take ?? 100,
    skip: filter.skip ?? 0,
  });
}

export function listDeadLetterJobs(take = 100): Promise<Job[]> {
  return listJobs({ status: JobStatus.DEAD_LETTER, take });
}

export function getJob(jobId: string): Promise<Job | null> {
  return prisma.job.findUnique({ where: { id: jobId } });
}

/** Returns a `{ status: count }` map for dashboards/monitoring. */
export async function countJobsByStatus(): Promise<Record<string, number>> {
  const groups = await prisma.job.groupBy({ by: ["status"], _count: { _all: true } });
  const out: Record<string, number> = {};
  for (const g of groups) {
    out[g.status] = g._count._all;
  }
  return out;
}

/** Returns a `{ type: count }` map for dashboards/monitoring. */
export async function countJobsByType(): Promise<Record<string, number>> {
  const groups = await prisma.job.groupBy({ by: ["type"], _count: { _all: true } });
  const out: Record<string, number> = {};
  for (const g of groups) {
    out[g.type] = g._count._all;
  }
  return out;
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

type ErrorHistoryEntry = {
  at: string;
  attempt: number;
  kind: JobErrorKind;
  message: string;
};

function appendErrorHistory(existing: Prisma.JsonValue, entry: ErrorHistoryEntry): ErrorHistoryEntry[] {
  const arr = Array.isArray(existing) ? (existing as unknown as ErrorHistoryEntry[]) : [];
  return [...arr, entry].slice(-MAX_ERROR_HISTORY);
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
