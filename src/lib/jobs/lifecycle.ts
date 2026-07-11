/**
 * Job lifecycle transitions: start, heartbeat, complete, fail, retry, cancel,
 * and archive (RW-015 / RW-993).
 *
 * Worker-owned transitions (start, heartbeat, complete, fail) use atomic CAS
 * via `updateMany` with both workerId and expected status predicates so a stale
 * owner can never overwrite a reclaimed job.
 *
 * Admin transitions (retry, cancel, archive) use atomic expected-status
 * predicates to prevent overwriting terminal or in-flight state.
 */
import { prisma } from "@/lib/prisma";
import { Prisma, JobStatus, type Job } from "@prisma/client";
import { createLogger } from "@/lib/observability/logger";
import { recordJobQueueEvent } from "@/lib/metrics";
import { retryPolicyFor, jobBackoffDelay, type RetryPolicy } from "./retry-policy";
import { classifyJobError, type JobErrorKind } from "./errors";
import { ACTIVE_STATUSES, TERMINAL_STATUSES } from "./types";

const log = createLogger("jobs");

/** How many error-history entries to retain (bounded growth). */
const MAX_ERROR_HISTORY = 25;

/** Statuses from which admin retry is allowed. */
const RETRYABLE_STATUSES: JobStatus[] = [JobStatus.FAILED, JobStatus.DEAD_LETTER];

/** Non-terminal statuses that admin cancel is allowed from. */
const CANCELLABLE_STATUSES: JobStatus[] = ACTIVE_STATUSES;

export type TransitionOptions = { now?: Date };

export type FailJobOptions = {
  /** Force permanent failure (straight to DEAD_LETTER) regardless of classification. */
  permanent?: boolean;
  /** Override the retry policy backoff for this failure. */
  backoff?: Partial<RetryPolicy>;
  now?: Date;
};

function transitionNow(opts: TransitionOptions): Date {
  return opts.now ?? new Date();
}

function releaseLockData(): { lockedBy: null; lockedAt: null } {
  return { lockedBy: null, lockedAt: null };
}

/**
 * Atomically transitions a CLAIMED job owned by `workerId` to RUNNING.
 * Returns the updated Job, or null if the CAS fails (ownership lost or wrong status).
 */
export async function startJob(
  jobId: string,
  workerId: string,
  opts: TransitionOptions = {},
): Promise<Job | null> {
  const now = transitionNow(opts);
  const res = await prisma.job.updateMany({
    where: { id: jobId, lockedBy: workerId, status: JobStatus.CLAIMED },
    data: {
      status: JobStatus.RUNNING,
      lockedAt: now,
      startedAt: now,
      updatedAt: now,
    },
  });
  if (res.count === 0) return null;
  return prisma.job.findUnique({ where: { id: jobId } });
}

/**
 * Refreshes a job's lock so a long-running task is not reclaimed as stale.
 * Requires active ownership (workerId match) AND RUNNING status.
 */
export async function heartbeatJob(
  jobId: string,
  workerId: string,
  opts: TransitionOptions = {},
): Promise<boolean> {
  const now = transitionNow(opts);
  const res = await prisma.job.updateMany({
    where: { id: jobId, lockedBy: workerId, status: JobStatus.RUNNING },
    data: { lockedAt: now, updatedAt: now },
  });
  return res.count > 0;
}

/**
 * Atomically completes a RUNNING job owned by `workerId`.
 * Returns the updated Job, or null if the CAS fails (ownership lost or wrong status).
 */
export async function completeJob(
  jobId: string,
  workerId: string,
  opts: TransitionOptions = {},
): Promise<Job | null> {
  const now = transitionNow(opts);
  const res = await prisma.job.updateMany({
    where: { id: jobId, lockedBy: workerId, status: JobStatus.RUNNING },
    data: {
      status: JobStatus.COMPLETED,
      completedAt: now,
      ...releaseLockData(),
      lastError: null,
      updatedAt: now,
    },
  });
  if (res.count === 0) return null;
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (job) recordJobQueueEvent({ event: "completed", type: job.type });
  return job;
}

/**
 * Records a job failure (RW-015). Atomically transitions a RUNNING job owned
 * by `workerId`. Increments `attempts`, appends to `errorHistory`, and either
 * schedules a retry (status FAILED, `runAfter` = now + backoff) or — when the
 * failure is permanent or attempts are exhausted — moves to DEAD_LETTER.
 *
 * Returns null if CAS fails (ownership lost or wrong status).
 */
export async function failJob(
  jobId: string,
  workerId: string,
  error: unknown,
  opts: FailJobOptions = {},
): Promise<Job | null> {
  const now = transitionNow(opts);

  // Read the job to compute retry logic; the CAS protects the write.
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
    const res = await prisma.job.updateMany({
      where: { id: jobId, lockedBy: workerId, status: JobStatus.RUNNING },
      data: {
        status: JobStatus.DEAD_LETTER,
        attempts,
        lastError: classified.message,
        errorHistory,
        failedAt: now,
        deadLetteredAt: now,
        ...releaseLockData(),
        updatedAt: now,
      },
    });
    if (res.count === 0) return null;
    recordJobQueueEvent({ event: "dead_letter", type: job.type });
    log.error("job dead-lettered", {
      jobId,
      type: job.type,
      attempts,
      reason: permanent ? `permanent:${classified.kind}` : "attempts_exhausted",
      lastError: classified.message,
    });
    return prisma.job.findUnique({ where: { id: jobId } });
  }

  const delay = jobBackoffDelay(attempts, policy.baseBackoffMs, policy.maxBackoffMs);
  const res = await prisma.job.updateMany({
    where: { id: jobId, lockedBy: workerId, status: JobStatus.RUNNING },
    data: {
      status: JobStatus.FAILED,
      attempts,
      lastError: classified.message,
      errorHistory,
      runAfter: new Date(now.getTime() + delay),
      failedAt: now,
      ...releaseLockData(),
      updatedAt: now,
    },
  });
  if (res.count === 0) return null;
  recordJobQueueEvent({ event: "retry", type: job.type });
  log.warn("job failed, scheduled retry", {
    jobId,
    type: job.type,
    attempt: attempts,
    nextRetryInMs: delay,
    error: classified.message,
  });
  return prisma.job.findUnique({ where: { id: jobId } });
}

/**
 * Re-queues a failed or dead-lettered job (admin action): resets it to PENDING,
 * clears attempts and error state, and makes it immediately runnable.
 * Uses atomic expected-status predicate to avoid overwriting active jobs.
 */
export async function retryJob(jobId: string, opts: TransitionOptions = {}): Promise<Job | null> {
  const now = transitionNow(opts);
  const res = await prisma.job.updateMany({
    where: { id: jobId, status: { in: RETRYABLE_STATUSES } },
    data: {
      status: JobStatus.PENDING,
      attempts: 0,
      runAfter: now,
      lastError: null,
      ...releaseLockData(),
      failedAt: null,
      deadLetteredAt: null,
      completedAt: null,
      startedAt: null,
      updatedAt: now,
    },
  });
  if (res.count === 0) return null;
  return prisma.job.findUnique({ where: { id: jobId } });
}

/**
 * Cancels a job by moving it to DEAD_LETTER (admin action).
 * Uses atomic expected-status predicate — only cancellable (non-terminal) jobs.
 */
export async function cancelJob(
  jobId: string,
  opts: TransitionOptions & { reason?: string } = {},
): Promise<Job | null> {
  const now = transitionNow(opts);
  const res = await prisma.job.updateMany({
    where: { id: jobId, status: { in: CANCELLABLE_STATUSES } },
    data: {
      status: JobStatus.DEAD_LETTER,
      lastError: opts.reason ?? "cancelled by admin",
      deadLetteredAt: now,
      ...releaseLockData(),
      updatedAt: now,
    },
  });
  if (res.count === 0) return null;
  return prisma.job.findUnique({ where: { id: jobId } });
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
  if (!TERMINAL_STATUSES.includes(job.status)) return null;
  await prisma.job.delete({ where: { id: jobId } });
  return job;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type ErrorHistoryEntry = {
  at: string;
  attempt: number;
  kind: JobErrorKind;
  message: string;
};

function isJobErrorKind(value: string): value is JobErrorKind {
  return (
    value === "provider" ||
    value === "validation" ||
    value === "missing" ||
    value === "permission" ||
    value === "unknown"
  );
}

function isRecord(value: Prisma.JsonValue): value is Record<string, Prisma.JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseErrorHistoryEntry(value: Prisma.JsonValue): ErrorHistoryEntry | null {
  if (!isRecord(value)) return null;
  const at = value.at;
  const attempt = value.attempt;
  const kind = value.kind;
  const message = value.message;
  if (
    typeof at !== "string" ||
    typeof attempt !== "number" ||
    !Number.isInteger(attempt) ||
    attempt <= 0 ||
    typeof kind !== "string" ||
    typeof message !== "string"
  ) {
    return null;
  }
  if (!isJobErrorKind(kind)) {
    return null;
  }
  return {
    at,
    attempt,
    kind,
    message,
  };
}

function existingErrorHistory(existing: Prisma.JsonValue): ErrorHistoryEntry[] {
  if (!Array.isArray(existing)) return [];
  const normalized: ErrorHistoryEntry[] = [];
  for (const item of existing) {
    const parsed = parseErrorHistoryEntry(item);
    if (parsed) normalized.push(parsed);
  }
  return normalized;
}

function appendErrorHistory(existing: Prisma.JsonValue, entry: ErrorHistoryEntry): Prisma.InputJsonArray {
  const rows = [...existingErrorHistory(existing), entry].slice(-MAX_ERROR_HISTORY);
  return rows.map((row) => ({
    at: row.at,
    attempt: row.attempt,
    kind: row.kind,
    message: row.message,
  }));
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
