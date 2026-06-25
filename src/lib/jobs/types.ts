/**
 * Shared types, status groups, and payload shapes for the job queue subsystem.
 */
import { JobStatus, JobType, type Job } from "@prisma/client";

export { JobStatus, JobType };
export type { Job };

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
