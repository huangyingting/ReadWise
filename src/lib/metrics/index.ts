/**
 * @/lib/metrics — public API barrel.
 *
 * Re-exports everything that callers and tests expect from this package.
 * Internal modules are split by concern:
 *
 *   registry      — types, state, counter/histogram/cache primitives, snapshot
 *   route-groups  — low-cardinality API path normalisation
 *   exporter      — Prometheus text-format serialisation
 *   recorders/    — per-domain record helpers (api, worker, ai, cache,
 *                   content, security, jobs)
 *
 * Callers may import from `@/lib/metrics` (this barrel) or from any submodule
 * directly when they depend on a single domain.
 */

export type { MetricLabelValue, CounterPoint, HistogramPoint, MetricsSnapshot } from "@/lib/metrics/registry";
export { getMetricsSnapshot, resetMetrics } from "@/lib/metrics/registry";

export { routeGroupFromPath } from "@/lib/metrics/route-groups";

export { exportMetricsPrometheus, escapePrometheusLabelValue } from "@/lib/metrics/exporter";

export { recordApiRequest } from "@/lib/metrics/recorders/api";
export { recordWorkerJob } from "@/lib/metrics/recorders/worker";
export { recordAiCall, recordAiRetry } from "@/lib/metrics/recorders/ai";
export { recordCacheLookup, recordCacheMiss, recordCacheAccess } from "@/lib/metrics/recorders/cache";
export {
  recordContentProcessingRun,
  recordContentProcessingStep,
  recordIngestionRun,
} from "@/lib/metrics/recorders/content";
export { recordErrorCaptured, recordSecurityEventMetric } from "@/lib/metrics/recorders/security";
export type { JobQueueEvent } from "@/lib/metrics/recorders/jobs";
export { recordJobQueueEvent, recordJobLockAge } from "@/lib/metrics/recorders/jobs";
