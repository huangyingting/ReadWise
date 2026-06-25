/**
 * Per-job-type retry policies and backoff calculation (RW-015).
 */
import { JobType } from "@prisma/client";
import { jitteredExponentialBackoff } from "@/lib/backoff";

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
