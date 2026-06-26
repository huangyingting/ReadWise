/**
 * Public API for the durable job queue subsystem (RW-013/014/015).
 *
 * Modules:
 *   types          — Prisma re-exports, status groups, payload shapes, constants.
 *   retry-policy   — Per-type retry policies and backoff calculation.
 *   errors         — JobError class and error classification.
 *   enqueue        — Enqueue and dedupe helpers.
 *   claim          — Atomic claim dispatcher (PostgreSQL vs. generic).
 *   claim-postgres — FOR UPDATE SKIP LOCKED adapter.
 *   claim-generic  — Serialized-transaction adapter (SQLite/test).
 *   lifecycle      — start, heartbeat, complete, fail, retry, cancel, archive.
 *   queries        — list/get/count helpers for dashboards and admin views.
 */

export {
  JobStatus,
  JobType,
  RUNNABLE_STATUSES,
  RECLAIMABLE_STATUSES,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  DEFAULT_LOCK_TTL_MS,
} from "./types";
export type { Job, ArticleJobPayload, ArticleIngestPayload, PushReminderPayload, JobPayload } from "./types";

export {
  DEFAULT_RETRY_POLICY,
  RETRY_POLICIES,
  retryPolicyFor,
  jobBackoffDelay,
} from "./retry-policy";
export type { RetryPolicy } from "./retry-policy";

export { JobError, classifyJobError } from "./errors";
export type { JobErrorKind, ClassifiedError } from "./errors";

export {
  enqueueJob,
  enqueueArticleProcess,
  enqueueArticleIngest,
  enqueueAiRebuild,
  enqueueTtsGenerate,
  enqueuePushReminder,
} from "./enqueue";
export type { EnqueueOptions } from "./enqueue";

export { claimNextJob } from "./claim";
export type { ClaimOptions } from "./claim";

export {
  startJob,
  heartbeatJob,
  completeJob,
  failJob,
  retryJob,
  cancelJob,
  archiveJob,
} from "./lifecycle";
export type { TransitionOptions, FailJobOptions } from "./lifecycle";

export {
  listJobs,
  listDeadLetterJobs,
  getJob,
  countJobsByStatus,
  countJobsByType,
} from "./queries";
export type { ListJobsFilter } from "./queries";

export {
  pruneTerminalJobs,
  jobTerminalRetentionDays,
  JOB_TERMINAL_STATUSES,
} from "./retention";
export type { PruneJobsClient } from "./retention";
