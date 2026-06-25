/**
 * Worker job metrics recorder.
 *
 * Records job outcomes, attempt counts, and per-outcome latency histograms for
 * the article-processing worker.
 */

import { incCounter, observeHistogram, normalizeOutcome, JOB_DURATION_BUCKETS_MS } from "@/lib/metrics/registry";

export function recordWorkerJob(input: {
  outcome: "success" | "failed" | "missing" | "aborted" | "unknown";
  attempts: number;
  published?: boolean;
  durationMs: number;
}): void {
  const outcome = normalizeOutcome(input.outcome, ["success", "failed", "missing", "aborted", "unknown"]);
  const labels = { outcome, published: input.published ? "true" : "false" };
  incCounter("readwise_worker_jobs_total", "Worker article jobs by outcome.", labels);
  incCounter(
    "readwise_worker_job_attempts_total",
    "Worker article job attempts by final outcome.",
    { outcome },
    Math.max(1, input.attempts || 1),
  );
  observeHistogram(
    "readwise_worker_job_duration_ms",
    "Worker article job duration in milliseconds.",
    JOB_DURATION_BUCKETS_MS,
    { outcome },
    input.durationMs,
  );
}
