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

const MINUTE_MS = 60 * 1000;
const DEFAULT_LOCK_TTL_MINUTES = 10;

/** Minimum shared worker lease that safely covers bounded discovery work. */
export const MIN_LOCK_TTL_MS = MINUTE_MS;
/** Default lock lease (ms). A lock older than this is considered stale. */
export const DEFAULT_LOCK_TTL_MS = DEFAULT_LOCK_TTL_MINUTES * MINUTE_MS;

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

/**
 * Candidate-based ARTICLE_INGEST payload for incremental ingestion (#1091).
 * METADATA ONLY — carries the ledger candidate identity + a controlled
 * processing version, NEVER a URL, provider policy, credentials, or article
 * data. See `candidate-ingest.ts` for the builder/validator/dedupe-key.
 */
export type CandidateIngestPayload = {
  candidateId: string;
  processingVersion: number;
};

export type PushReminderPayload = {
  userId?: string;
} & Record<string, unknown>;

export type JobPayload = Record<string, unknown>;
