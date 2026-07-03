/**
 * Worker job metrics recorder.
 *
 * Records job outcomes, attempt counts, and per-outcome latency histograms for
 * the article-processing worker.
 */

import { incCounter, observeHistogram, normalizeOutcome, JOB_DURATION_BUCKETS_MS } from "@/lib/metrics/registry";

type WorkerJobOutcome = "success" | "failed" | "missing" | "aborted" | "unknown";

type WorkerJobMetricInput = {
  outcome: WorkerJobOutcome;
  attempts: number;
  published?: boolean;
  durationMs: number;
};

const WORKER_JOB_OUTCOMES: readonly WorkerJobOutcome[] = [
  "success",
  "failed",
  "missing",
  "aborted",
  "unknown",
];

const WORKER_JOB_METRICS = {
  jobsTotal: {
    name: "readwise_worker_jobs_total",
    help: "Worker article jobs by outcome.",
  },
  attemptsTotal: {
    name: "readwise_worker_job_attempts_total",
    help: "Worker article job attempts by final outcome.",
  },
  durationMs: {
    name: "readwise_worker_job_duration_ms",
    help: "Worker article job duration in milliseconds.",
  },
} as const;

function normalizeWorkerOutcome(outcome: WorkerJobOutcome): string {
  return normalizeOutcome(outcome, WORKER_JOB_OUTCOMES);
}

function countAttempts(attempts: number): number {
  return Math.max(1, attempts || 1);
}

export function recordWorkerJob(input: WorkerJobMetricInput): void {
  const outcome = normalizeWorkerOutcome(input.outcome);
  const labels = { outcome, published: input.published ? "true" : "false" };
  incCounter(WORKER_JOB_METRICS.jobsTotal.name, WORKER_JOB_METRICS.jobsTotal.help, labels);
  incCounter(
    WORKER_JOB_METRICS.attemptsTotal.name,
    WORKER_JOB_METRICS.attemptsTotal.help,
    { outcome },
    countAttempts(input.attempts),
  );
  observeHistogram(
    WORKER_JOB_METRICS.durationMs.name,
    WORKER_JOB_METRICS.durationMs.help,
    JOB_DURATION_BUCKETS_MS,
    { outcome },
    input.durationMs,
  );
}
