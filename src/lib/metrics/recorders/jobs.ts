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

const JOB_QUEUE_EVENT_METRIC = {
  name: "readwise_job_queue_events_total",
  help: "Background job queue lifecycle events by type and event.",
} as const;

const JOB_STALE_LOCK_AGE_METRIC = {
  name: "readwise_job_stale_lock_age_ms",
  help: "Age of recovered stale job locks in milliseconds.",
} as const;

function normalizedJobLabels(type: string) {
  return { type: normalizeLabelValue(type) };
}

/**
 * Records a background-job-queue lifecycle event (RW-013/014/015). `type` is the
 * job type (low cardinality); `event` is normalized to a known lifecycle stage,
 * giving operators visibility into retries, dead-letters, and stale-lock recovery.
 */
export function recordJobQueueEvent(input: { event: JobQueueEvent; type: string }): void {
  incCounter(JOB_QUEUE_EVENT_METRIC.name, JOB_QUEUE_EVENT_METRIC.help, {
    event: normalizeOutcome(input.event, JOB_QUEUE_EVENTS),
    ...normalizedJobLabels(input.type),
  });
}

/** Observes the age (ms) of a lock that was recovered as stale during claiming. */
export function recordJobLockAge(type: string, ageMs: number): void {
  observeHistogram(
    JOB_STALE_LOCK_AGE_METRIC.name,
    JOB_STALE_LOCK_AGE_METRIC.help,
    JOB_DURATION_BUCKETS_MS,
    normalizedJobLabels(type),
    ageMs,
  );
}
