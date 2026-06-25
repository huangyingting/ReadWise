/**
 * Background job queue metrics recorders.
 *
 * Covers lifecycle event counts and stale-lock age histograms. The job `type`
 * is normalised so raw identifiers never appear as labels.
 */

import {
  incCounter,
  observeHistogram,
  normalizeLabelValue,
  normalizeOutcome,
  JOB_DURATION_BUCKETS_MS,
} from "@/lib/metrics/registry";

const JOB_QUEUE_EVENTS = [
  "enqueued",
  "claimed",
  "completed",
  "retry",
  "dead_letter",
  "stale_reclaimed",
] as const;

export type JobQueueEvent = (typeof JOB_QUEUE_EVENTS)[number];

/**
 * Records a background-job-queue lifecycle event (RW-013/014/015). `type` is the
 * job type (low cardinality); `event` is normalized to a known lifecycle stage,
 * giving operators visibility into retries, dead-letters, and stale-lock recovery.
 */
export function recordJobQueueEvent(input: { event: JobQueueEvent; type: string }): void {
  incCounter("readwise_job_queue_events_total", "Background job queue lifecycle events by type and event.", {
    event: normalizeOutcome(input.event, JOB_QUEUE_EVENTS),
    type: normalizeLabelValue(input.type),
  });
}

/** Observes the age (ms) of a lock that was recovered as stale during claiming. */
export function recordJobLockAge(type: string, ageMs: number): void {
  observeHistogram(
    "readwise_job_stale_lock_age_ms",
    "Age of recovered stale job locks in milliseconds.",
    JOB_DURATION_BUCKETS_MS,
    { type: normalizeLabelValue(type) },
    ageMs,
  );
}
