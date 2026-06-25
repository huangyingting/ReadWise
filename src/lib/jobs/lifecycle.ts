/**
 * Job lifecycle transitions: start, heartbeat, complete, fail, retry, cancel,
 * and archive (RW-015).
 */
import { prisma } from "@/lib/prisma";
import { Prisma, JobStatus, type Job } from "@prisma/client";
import { createLogger } from "@/lib/observability/logger";
import { recordJobQueueEvent } from "@/lib/metrics";
import { retryPolicyFor, jobBackoffDelay, type RetryPolicy } from "./retry-policy";
import { classifyJobError, type JobErrorKind } from "./errors";

const log = createLogger("jobs");

/** How many error-history entries to retain (bounded growth). */
const MAX_ERROR_HISTORY = 25;

export type TransitionOptions = { now?: Date };

export type FailJobOptions = {
  /** Force permanent failure (straight to DEAD_LETTER) regardless of classification. */
  permanent?: boolean;
  /** Override the retry policy backoff for this failure. */
  backoff?: Partial<RetryPolicy>;
  now?: Date;
};

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

// ---------------------------------------------------------------------------
// Internals
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
