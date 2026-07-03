/**
 * Per-job-type retry policies and backoff calculation (RW-015).
 */
import { JobType } from "@prisma/client";
import { jitteredExponentialBackoff } from "@/lib/backoff";

const MINUTE_MS = 60 * 1000;
const FIVE_MINUTES_MS = 5 * MINUTE_MS;
const TEN_MINUTES_MS = 10 * MINUTE_MS;

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
  maxBackoffMs: FIVE_MINUTES_MS,
};

function retryPolicy(
  maxAttempts: number,
  baseBackoffMs: number,
  maxBackoffMs: number,
): RetryPolicy {
  return { maxAttempts, baseBackoffMs, maxBackoffMs };
}

/** Per-job-type retry policies. Tunes attempt limits + backoff per workload. */
export const RETRY_POLICIES: Record<JobType, RetryPolicy> = {
  [JobType.ARTICLE_INGEST]: retryPolicy(5, 2000, FIVE_MINUTES_MS),
  [JobType.ARTICLE_PROCESS]: retryPolicy(5, 2000, FIVE_MINUTES_MS),
  [JobType.AI_REBUILD]: retryPolicy(4, 5000, TEN_MINUTES_MS),
  [JobType.TTS_GENERATE]: retryPolicy(3, 5000, TEN_MINUTES_MS),
  [JobType.PUSH_REMINDER]: retryPolicy(3, 1000, MINUTE_MS),
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
