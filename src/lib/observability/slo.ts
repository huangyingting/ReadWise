/**
 * Service Level Indicators & Objectives for product-critical flows (RW-034).
 *
 * This module is the single source of truth for *what* we measure (the SLI
 * catalog) and *how healthy* we expect it to be (the SLO targets). It reads the
 * EXISTING in-process metrics ({@link "@/lib/metrics"}) — API request counters
 * and latency histograms, worker job outcomes/latency, and AI call
 * outcomes/latency — so no new measurement plumbing is required.
 *
 * SLIs are split into two classes per the acceptance criteria:
 *   - "interactive": user-facing latency/availability (sign-in, dashboard,
 *     reader, progress save, dictionary, AI response, import) — tight targets.
 *   - "background": enrichment that runs off the request path (worker
 *     processing latency) — looser targets, throughput over latency.
 *
 * {@link evaluateSlos} computes the current status of every SLI from a metrics
 * snapshot (defaulting to the live one), ready for a dashboard or a breach
 * alert.
 *
 * Part of the observability package (REF-053). This is the canonical
 * implementation.
 */
import {
  getMetricsSnapshot,
  type CounterPoint,
  type HistogramPoint,
  type MetricsSnapshot,
} from "@/lib/metrics";

export type SliCategory = "interactive" | "background";
export type SliKind = "availability" | "latency";

/** How an SLI is measured against the metrics snapshot. */
export type SliMeasurement =
  | {
      metric: "api";
      kind: SliKind;
      /** Exact route group (from `routeGroupFromPath`), e.g. "/api/dictionary". */
      routeExact?: string;
      /** Any route group starting with this prefix, e.g. "/api/reader/". */
      routePrefix?: string;
      /** Latency target boundary in ms (latency SLIs only). */
      latencyThresholdMs?: number;
    }
  | { metric: "worker"; kind: SliKind; latencyThresholdMs?: number }
  | { metric: "ai"; kind: SliKind; latencyThresholdMs?: number };

/** A single SLI definition + its SLO target. */
export type SliDefinition = {
  key: string;
  /** Product flow this indicator covers. */
  flow: string;
  title: string;
  description: string;
  category: SliCategory;
  /**
   * Target as a proportion in [0,1]. For availability SLIs it is the fraction
   * of non-failing requests; for latency SLIs it is the fraction of requests
   * completing within `measurement.latencyThresholdMs`.
   */
  objective: number;
  measurement: SliMeasurement;
};

export type SliStatus = "ok" | "breaching" | "no_data";

export type SliEvaluation = {
  key: string;
  flow: string;
  title: string;
  category: SliCategory;
  kind: SliKind;
  objective: number;
  latencyThresholdMs?: number;
  /** Measured proportion in [0,1], or null when there is no data yet. */
  value: number | null;
  /** Number of observations behind `value`. */
  sampleCount: number;
  status: SliStatus;
};

export type SloReport = {
  evaluatedAt: string;
  total: number;
  ok: number;
  breaching: number;
  noData: number;
  slis: SliEvaluation[];
};

/**
 * The SLI catalog. Targets are intentionally conservative initial values to be
 * refined with production data (see docs/observability.md).
 */
export const SLI_CATALOG: SliDefinition[] = [
  {
    key: "sign_in",
    flow: "Sign-in",
    title: "Sign-in availability",
    description:
      "Authentication endpoints respond without server errors. Measured across /api/auth/* route groups (NextAuth owns its handler, so coverage is partial).",
    category: "interactive",
    objective: 0.995,
    measurement: { metric: "api", kind: "availability", routePrefix: "/api/auth" },
  },
  {
    key: "dashboard_load",
    flow: "Dashboard load",
    title: "Dashboard feed latency",
    description:
      "The dashboard feed API returns quickly. Approximates page-load latency until client RUM exists.",
    category: "interactive",
    objective: 0.95,
    measurement: {
      metric: "api",
      kind: "latency",
      routeExact: "/api/feed",
      latencyThresholdMs: 1000,
    },
  },
  {
    key: "reader_load",
    flow: "Article reader load",
    title: "Reader API latency",
    description:
      "The reader's interactive API surface (progress, vocabulary, quiz, translate, speech) responds quickly. Measured across /api/reader/* route groups.",
    category: "interactive",
    objective: 0.9,
    measurement: {
      metric: "api",
      kind: "latency",
      routePrefix: "/api/reader/",
      latencyThresholdMs: 2500,
    },
  },
  {
    key: "progress_save",
    flow: "Reading progress save",
    title: "Progress save latency",
    description: "Saving reading progress completes quickly so scroll position is never lost.",
    category: "interactive",
    objective: 0.95,
    measurement: {
      metric: "api",
      kind: "latency",
      routeExact: "/api/reader/[id]/progress",
      latencyThresholdMs: 500,
    },
  },
  {
    key: "dictionary_lookup",
    flow: "Dictionary lookup",
    title: "Dictionary lookup latency",
    description: "Word lookups resolve quickly while reading.",
    category: "interactive",
    objective: 0.9,
    measurement: {
      metric: "api",
      kind: "latency",
      routeExact: "/api/dictionary",
      latencyThresholdMs: 2500,
    },
  },
  {
    key: "ai_feature_response",
    flow: "AI feature response",
    title: "AI provider availability",
    description:
      "AI-backed features (translation, quiz, vocabulary, tutor) get a successful provider response. Denominator excludes unconfigured/aborted calls.",
    category: "interactive",
    objective: 0.95,
    measurement: { metric: "ai", kind: "availability" },
  },
  {
    key: "ai_feature_latency",
    flow: "AI feature response",
    title: "AI provider latency",
    description: "AI provider calls complete within an interactive budget.",
    category: "interactive",
    objective: 0.9,
    measurement: { metric: "ai", kind: "latency", latencyThresholdMs: 10000 },
  },
  {
    key: "import_success",
    flow: "Article import",
    title: "Import availability",
    description: "User-initiated article imports succeed without server errors.",
    category: "interactive",
    objective: 0.95,
    measurement: {
      metric: "api",
      kind: "availability",
      routeExact: "/api/articles/import",
    },
  },
  {
    key: "worker_processing",
    flow: "Background processing",
    title: "Worker job success",
    description: "Background article-processing jobs complete successfully (excludes missing/aborted).",
    category: "background",
    objective: 0.9,
    measurement: { metric: "worker", kind: "availability" },
  },
  {
    key: "worker_latency",
    flow: "Background processing",
    title: "Worker processing latency",
    description: "Background article processing completes within the latency budget.",
    category: "background",
    objective: 0.9,
    measurement: { metric: "worker", kind: "latency", latencyThresholdMs: 30000 },
  },
];

// ---- snapshot readers ----------------------------------------------------

function counterMatches(
  point: CounterPoint,
  name: string,
  labelFilter?: (labels: Record<string, string>) => boolean,
): boolean {
  if (point.name !== name) return false;
  return labelFilter ? labelFilter(point.labels) : true;
}

function sumCounters(
  snapshot: MetricsSnapshot,
  name: string,
  labelFilter?: (labels: Record<string, string>) => boolean,
): number {
  return snapshot.counters
    .filter((point) => counterMatches(point, name, labelFilter))
    .reduce((total, point) => total + point.value, 0);
}

function routeLabelMatcher(measurement: {
  routeExact?: string;
  routePrefix?: string;
}): (labels: Record<string, string>) => boolean {
  return (labels) => {
    const route = labels.route ?? "";
    if (measurement.routeExact !== undefined) return route === measurement.routeExact;
    if (measurement.routePrefix !== undefined) return route.startsWith(measurement.routePrefix);
    return true;
  };
}

/** Cumulative count of observations <= thresholdMs across matching histograms. */
function histogramFastFraction(
  points: HistogramPoint[],
  thresholdMs: number,
): { fast: number; total: number } {
  let fast = 0;
  let total = 0;
  for (const point of points) {
    total += point.count;
    // Buckets are cumulative; pick the largest le <= threshold.
    let best = 0;
    for (const bucket of point.buckets) {
      if (bucket.le <= thresholdMs) best = Math.max(best, bucket.count);
    }
    fast += best;
  }
  return { fast, total };
}

function histogramsMatching(
  snapshot: MetricsSnapshot,
  name: string,
  labelFilter?: (labels: Record<string, string>) => boolean,
): HistogramPoint[] {
  return snapshot.histograms.filter(
    (point) => point.name === name && (labelFilter ? labelFilter(point.labels) : true),
  );
}

// ---- evaluation ----------------------------------------------------------

function evaluateApi(
  snapshot: MetricsSnapshot,
  measurement: Extract<SliMeasurement, { metric: "api" }>,
): { value: number | null; sampleCount: number } {
  const routeFilter = routeLabelMatcher(measurement);
  if (measurement.kind === "availability") {
    const total = sumCounters(snapshot, "readwise_api_requests_total", routeFilter);
    if (total === 0) return { value: null, sampleCount: 0 };
    const failing = sumCounters(
      snapshot,
      "readwise_api_requests_total",
      (labels) => routeFilter(labels) && labels.status_class === "5xx",
    );
    return { value: (total - failing) / total, sampleCount: total };
  }
  const points = histogramsMatching(snapshot, "readwise_api_request_duration_ms", routeFilter);
  const { fast, total } = histogramFastFraction(points, measurement.latencyThresholdMs ?? 0);
  if (total === 0) return { value: null, sampleCount: 0 };
  return { value: fast / total, sampleCount: total };
}

function evaluateWorker(
  snapshot: MetricsSnapshot,
  measurement: Extract<SliMeasurement, { metric: "worker" }>,
): { value: number | null; sampleCount: number } {
  if (measurement.kind === "availability") {
    const denom = sumCounters(
      snapshot,
      "readwise_worker_jobs_total",
      (labels) => labels.outcome === "success" || labels.outcome === "failed",
    );
    if (denom === 0) return { value: null, sampleCount: 0 };
    const good = sumCounters(
      snapshot,
      "readwise_worker_jobs_total",
      (labels) => labels.outcome === "success",
    );
    return { value: good / denom, sampleCount: denom };
  }
  const points = histogramsMatching(snapshot, "readwise_worker_job_duration_ms");
  const { fast, total } = histogramFastFraction(points, measurement.latencyThresholdMs ?? 0);
  if (total === 0) return { value: null, sampleCount: 0 };
  return { value: fast / total, sampleCount: total };
}

function evaluateAi(
  snapshot: MetricsSnapshot,
  measurement: Extract<SliMeasurement, { metric: "ai" }>,
): { value: number | null; sampleCount: number } {
  if (measurement.kind === "availability") {
    const denom = sumCounters(
      snapshot,
      "readwise_ai_calls_total",
      (labels) => labels.outcome === "success" || labels.outcome === "error",
    );
    if (denom === 0) return { value: null, sampleCount: 0 };
    const good = sumCounters(
      snapshot,
      "readwise_ai_calls_total",
      (labels) => labels.outcome === "success",
    );
    return { value: good / denom, sampleCount: denom };
  }
  const points = histogramsMatching(
    snapshot,
    "readwise_ai_call_duration_ms",
    (labels) => labels.outcome === "success",
  );
  const { fast, total } = histogramFastFraction(points, measurement.latencyThresholdMs ?? 0);
  if (total === 0) return { value: null, sampleCount: 0 };
  return { value: fast / total, sampleCount: total };
}

function evaluateOne(snapshot: MetricsSnapshot, def: SliDefinition): SliEvaluation {
  const { measurement } = def;
  const result =
    measurement.metric === "api"
      ? evaluateApi(snapshot, measurement)
      : measurement.metric === "worker"
        ? evaluateWorker(snapshot, measurement)
        : evaluateAi(snapshot, measurement);

  const status: SliStatus =
    result.value === null ? "no_data" : result.value >= def.objective ? "ok" : "breaching";

  return {
    key: def.key,
    flow: def.flow,
    title: def.title,
    category: def.category,
    kind: measurement.kind,
    objective: def.objective,
    latencyThresholdMs:
      "latencyThresholdMs" in measurement ? measurement.latencyThresholdMs : undefined,
    value: result.value,
    sampleCount: result.sampleCount,
    status,
  };
}

/**
 * Evaluate every SLI against a metrics snapshot (defaults to the live one) and
 * summarize. SLIs with no data yet are reported as `no_data`, not failing.
 */
export function evaluateSlos(snapshot: MetricsSnapshot = getMetricsSnapshot()): SloReport {
  const slis = SLI_CATALOG.map((def) => evaluateOne(snapshot, def));
  return {
    evaluatedAt: new Date().toISOString(),
    total: slis.length,
    ok: slis.filter((sli) => sli.status === "ok").length,
    breaching: slis.filter((sli) => sli.status === "breaching").length,
    noData: slis.filter((sli) => sli.status === "no_data").length,
    slis,
  };
}
