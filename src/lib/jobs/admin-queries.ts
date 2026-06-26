/**
 * Admin job dashboard read-side helpers (RW-017).
 *
 * Paginated listing + aggregate counts + stuck/failed surfacing over the
 * persistent `Job` table. The heavy lifting (locking, retry policy, lifecycle
 * transitions) lives in `@/lib/jobs`.
 */
import { prisma } from "@/lib/prisma";
import { Prisma, JobStatus, JobType, type Job } from "@prisma/client";
import {
  DEFAULT_LOCK_TTL_MS,
  TERMINAL_STATUSES,
  countJobsByStatus,
  countJobsByType,
  listJobs,
} from "@/lib/jobs";

export { JobStatus, JobType };

/** Page size for the admin job listing. */
export const ADMIN_JOBS_PAGE_SIZE = 25;

/** Statuses considered "in flight" for the stuck-job query. */
const IN_FLIGHT_STATUSES: JobStatus[] = [JobStatus.CLAIMED, JobStatus.RUNNING];

export type AdminJobRow = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  priority: number;
  /** articleId extracted from the job payload (display + drill-down). */
  articleId: string | null;
  /** Optional feature label carried by backfill jobs. */
  feature: string | null;
  dedupeKey: string | null;
  lastError: string | null;
  runAfter: Date;
  lockedBy: string | null;
  lockedAt: Date | null;
  /** Age (ms) of the current lock, or null when not locked. */
  lockAgeMs: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  deadLetteredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function payloadOf(job: Job): Record<string, unknown> {
  const payload = job.payload;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function toRow(job: Job, now: Date): AdminJobRow {
  const payload = payloadOf(job);
  const articleId = typeof payload.articleId === "string" ? payload.articleId : null;
  const feature = typeof payload.feature === "string" ? payload.feature : null;
  const lockAgeMs = job.lockedAt
    ? Math.max(0, now.getTime() - new Date(job.lockedAt).getTime())
    : null;
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    priority: job.priority,
    articleId,
    feature,
    dedupeKey: job.dedupeKey,
    lastError: job.lastError,
    runAfter: job.runAfter,
    lockedBy: job.lockedBy,
    lockedAt: job.lockedAt,
    lockAgeMs,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: job.failedAt,
    deadLetteredAt: job.deadLetteredAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export type ListAdminJobsOpts = {
  status?: string | null;
  type?: string | null;
  /** Matches the articleId encoded in the job's dedupeKey/payload. */
  articleId?: string | null;
  /** Substring match against `lastError` (failure reason). */
  failureReason?: string | null;
  /** Only jobs whose lock is older than the lock TTL (stuck/locked). */
  stuck?: boolean;
  /** Only jobs created on/after this time. */
  createdAfter?: Date | null;
  /** Only jobs created on/before this time. */
  createdBefore?: Date | null;
  page?: number;
  pageSize?: number;
  lockTtlMs?: number;
  now?: Date;
};

export type AdminJobsResult = {
  jobs: AdminJobRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  status: string | null;
  type: string | null;
  articleId: string | null;
  failureReason: string | null;
  stuck: boolean;
};

function normalizeStatus(value: string | null | undefined): JobStatus | null {
  const candidate = value?.trim().toUpperCase();
  return candidate && (Object.values(JobStatus) as string[]).includes(candidate)
    ? (candidate as JobStatus)
    : null;
}

function normalizeType(value: string | null | undefined): JobType | null {
  const candidate = value?.trim().toUpperCase();
  return candidate && (Object.values(JobType) as string[]).includes(candidate)
    ? (candidate as JobType)
    : null;
}

/**
 * Paginated, filterable job listing for the admin dashboard. Filters by status,
 * type, the encoded articleId (via dedupeKey), failure reason (substring of
 * lastError), created-time window, and a "stuck" flag (lock older than the lock
 * TTL). Unknown status/type filters are ignored (treated as "all").
 */
export async function listAdminJobs(
  opts: ListAdminJobsOpts = {},
): Promise<AdminJobsResult> {
  const now = opts.now ?? new Date();
  const staleBefore = new Date(now.getTime() - (opts.lockTtlMs ?? DEFAULT_LOCK_TTL_MS));
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? ADMIN_JOBS_PAGE_SIZE));
  const page = Math.max(1, opts.page ?? 1);

  const status = normalizeStatus(opts.status);
  const type = normalizeType(opts.type);
  const articleId = opts.articleId?.trim() || null;
  const failureReason = opts.failureReason?.trim() || null;
  const stuck = Boolean(opts.stuck);

  const where: Prisma.JobWhereInput = {};
  if (stuck) {
    where.status = status ? status : { in: IN_FLIGHT_STATUSES };
    where.lockedAt = { lt: staleBefore };
  } else if (status) {
    where.status = status;
  }
  if (type) where.type = type;
  if (articleId) where.dedupeKey = { contains: articleId };
  if (failureReason) where.lastError = { contains: failureReason };
  if (opts.createdAfter || opts.createdBefore) {
    where.createdAt = {
      ...(opts.createdAfter ? { gte: opts.createdAfter } : {}),
      ...(opts.createdBefore ? { lte: opts.createdBefore } : {}),
    };
  }

  const [total, rows] = await Promise.all([
    prisma.job.count({ where }),
    prisma.job.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    jobs: rows.map((job) => toRow(job, now)),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    status,
    type,
    articleId,
    failureReason,
    stuck,
  };
}

export type JobDashboard = {
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  total: number;
  stuck: number;
  recentFailures: AdminJobRow[];
  deadLetter: AdminJobRow[];
};

/**
 * Aggregate overview for the top of the dashboard: counts by status and type,
 * the number of stuck/locked jobs, and a handful of the most recent failures
 * and dead-letter jobs.
 */
export async function getJobDashboard(
  opts: { lockTtlMs?: number; now?: Date; recent?: number } = {},
): Promise<JobDashboard> {
  const now = opts.now ?? new Date();
  const staleBefore = new Date(now.getTime() - (opts.lockTtlMs ?? DEFAULT_LOCK_TTL_MS));
  const recent = opts.recent ?? 10;

  const [byStatus, byType, stuck, failures, dead] = await Promise.all([
    countJobsByStatus(),
    countJobsByType(),
    prisma.job.count({
      where: { status: { in: IN_FLIGHT_STATUSES }, lockedAt: { lt: staleBefore } },
    }),
    listJobs({ status: JobStatus.FAILED, take: recent }),
    listJobs({ status: JobStatus.DEAD_LETTER, take: recent }),
  ]);

  const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);

  return {
    byStatus,
    byType,
    total,
    stuck,
    recentFailures: failures.map((job) => toRow(job, now)),
    deadLetter: dead.map((job) => toRow(job, now)),
  };
}
