/**
 * Lightweight in-process application metrics.
 *
 * The API is intentionally narrow: callers record well-known events and this
 * module owns label normalization so metrics stay low-cardinality and safe to
 * expose to administrators. Do not add user ids, request ids, raw article ids,
 * full unnormalized paths, or other unbounded labels here.
 */

export type MetricLabelValue = string | number | boolean | null | undefined;

export type CounterPoint = {
  name: string;
  help: string;
  labels: Record<string, string>;
  value: number;
};

export type HistogramPoint = {
  name: string;
  help: string;
  labels: Record<string, string>;
  buckets: { le: number; count: number }[];
  count: number;
  sum: number;
};

export type MetricsSnapshot = {
  counters: CounterPoint[];
  histograms: HistogramPoint[];
};

const API_DURATION_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const AI_DURATION_BUCKETS_MS = [100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];
const JOB_DURATION_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 15000, 30000, 120000];

type CounterDef = { help: string; labels: Record<string, string>; value: number };
type HistogramDef = {
  help: string;
  labels: Record<string, string>;
  buckets: number[];
  counts: number[];
  count: number;
  sum: number;
};

const counters = new Map<string, CounterDef>();
const histograms = new Map<string, HistogramDef>();
const cacheStats = new Map<string, { lookups: number; misses: number }>();

function normalizeLabelValue(value: MetricLabelValue, fallback = "unknown"): string {
  const raw = String(value ?? fallback).trim();
  if (!raw) return fallback;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_.:/[\]-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80) || fallback;
}

function labelsKey(labels: Record<string, string>): string {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key]}`)
    .join(",");
}

function seriesKey(name: string, labels: Record<string, string>): string {
  return `${name}|${labelsKey(labels)}`;
}

function incCounter(
  name: string,
  help: string,
  labels: Record<string, MetricLabelValue> = {},
  amount = 1,
): void {
  const normalized = Object.fromEntries(
    Object.entries(labels).map(([key, value]) => [key, normalizeLabelValue(value)]),
  );
  const key = seriesKey(name, normalized);
  const current = counters.get(key);
  if (current) {
    current.value += amount;
    return;
  }
  counters.set(key, { help, labels: normalized, value: amount });
}

function observeHistogram(
  name: string,
  help: string,
  buckets: number[],
  labels: Record<string, MetricLabelValue>,
  value: number,
): void {
  const normalized = Object.fromEntries(
    Object.entries(labels).map(([key, val]) => [key, normalizeLabelValue(val)]),
  );
  const key = seriesKey(name, normalized);
  const safeValue = Number.isFinite(value) && value >= 0 ? value : 0;
  let current = histograms.get(key);
  if (!current) {
    current = {
      help,
      labels: normalized,
      buckets,
      counts: buckets.map(() => 0),
      count: 0,
      sum: 0,
    };
    histograms.set(key, current);
  }
  current.count++;
  current.sum += safeValue;
  for (let i = 0; i < current.buckets.length; i++) {
    if (safeValue <= current.buckets[i]) {
      current.counts[i]++;
    }
  }
}

function statusClass(status: number | string): string {
  const n = typeof status === "number" ? status : Number(status);
  if (!Number.isFinite(n) || n <= 0) return "unknown";
  return `${Math.floor(n / 100)}xx`;
}

function normalizeMethod(method: string): string {
  const upper = method.toUpperCase();
  return /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(upper) ? upper : "OTHER";
}

function normalizeOutcome(value: string, allowed: readonly string[]): string {
  return allowed.includes(value) ? value : "unknown";
}

function isDynamicApiSegment(
  segment: string,
  index: number,
  segments: string[],
): boolean {
  const previous = segments[index - 1];
  const beforePrevious = segments[index - 2];
  if (segment === "[id]") return true;
  if (segment === "ingest") return false;
  if (/^\d+$/.test(segment)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) {
    return true;
  }
  if (segment.length >= 12 && /^[a-z0-9_-]+$/i.test(segment)) return true;
  if (previous === "reader" || previous === "highlights" || previous === "lists" || previous === "items") {
    return true;
  }
  if (beforePrevious === "admin" && (previous === "articles" || previous === "tags" || previous === "members")) {
    return true;
  }
  return false;
}

function sanitizeRouteSegment(segment: string): string {
  return normalizeLabelValue(segment, "segment").replace(/\.+/g, ".");
}

export function routeGroupFromPath(pathname: string): string {
  const cleanPath = pathname.split("?")[0] ?? pathname;
  const segments = cleanPath.split("/").filter(Boolean);
  if (segments[0] !== "api") return "/other";
  const grouped = segments.map((segment, index) =>
    isDynamicApiSegment(segment, index, segments) ? "[id]" : sanitizeRouteSegment(segment),
  );
  const capped = grouped.length > 7 ? [...grouped.slice(0, 7), "[...]"] : grouped;
  return `/${capped.join("/")}`;
}

export function recordApiRequest(input: {
  method: string;
  route: string;
  status: number;
  durationMs: number;
}): void {
  const labels = {
    method: normalizeMethod(input.method),
    route: routeGroupFromPath(input.route),
    status: String(input.status),
    status_class: statusClass(input.status),
  };
  incCounter("readwise_api_requests_total", "Total API responses by route group and status.", labels);
  observeHistogram(
    "readwise_api_request_duration_ms",
    "API response latency in milliseconds.",
    API_DURATION_BUCKETS_MS,
    { method: labels.method, route: labels.route, status_class: labels.status_class },
    input.durationMs,
  );
}

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

export function recordAiCall(input: {
  feature: string;
  outcome: "success" | "error" | "empty" | "unconfigured" | "aborted";
  status?: number | string;
  durationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}): void {
  const feature = normalizeLabelValue(input.feature);
  const outcome = normalizeOutcome(input.outcome, ["success", "error", "empty", "unconfigured", "aborted"]);
  const status_class =
    input.status === undefined ? (outcome === "unconfigured" ? "unconfigured" : "network") : statusClass(input.status);
  incCounter("readwise_ai_calls_total", "AI provider calls by feature and outcome.", {
    feature,
    outcome,
    status_class,
  });
  if (input.durationMs !== undefined) {
    observeHistogram(
      "readwise_ai_call_duration_ms",
      "AI provider call duration in milliseconds.",
      AI_DURATION_BUCKETS_MS,
      { feature, outcome },
      input.durationMs,
    );
  }
  const tokenEntries = [
    ["prompt", input.promptTokens],
    ["completion", input.completionTokens],
    ["total", input.totalTokens],
  ] as const;
  for (const [type, value] of tokenEntries) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      incCounter("readwise_ai_tokens_total", "AI token usage totals.", { feature, type }, value);
    }
  }
}

export function recordAiRetry(input: {
  feature: string;
  reason: string;
}): void {
  incCounter("readwise_ai_retries_total", "AI provider retries by feature and reason.", {
    feature: input.feature,
    reason: input.reason,
  });
}

export function recordCacheLookup(cache: string): void {
  const name = normalizeLabelValue(cache);
  const current = cacheStats.get(name) ?? { lookups: 0, misses: 0 };
  current.lookups++;
  cacheStats.set(name, current);
}

export function recordCacheMiss(cache: string): void {
  const name = normalizeLabelValue(cache);
  const current = cacheStats.get(name) ?? { lookups: 0, misses: 0 };
  current.misses++;
  cacheStats.set(name, current);
}

export function recordCacheAccess(cache: string, outcome: "hit" | "miss"): void {
  recordCacheLookup(cache);
  if (outcome === "miss") recordCacheMiss(cache);
}

export function recordContentProcessingRun(input: {
  outcome: "success" | "failed" | "missing";
  published?: boolean;
}): void {
  incCounter("readwise_content_processing_runs_total", "Article processing runs by outcome.", {
    outcome: input.outcome,
    published: input.published ? "true" : "false",
  });
}

export function recordContentProcessingStep(input: {
  step: string;
  status: string;
}): void {
  incCounter("readwise_content_processing_steps_total", "Article processing steps by status.", {
    step: input.step,
    status: input.status,
  });
}

function cacheCounterPoints(): CounterPoint[] {
  const help = "Cache accesses by cache name and derived hit/miss outcome.";
  const points: CounterPoint[] = [];
  for (const [cache, stats] of cacheStats) {
    const misses = Math.max(0, stats.misses);
    const hits = Math.max(0, stats.lookups - stats.misses);
    points.push({
      name: "readwise_cache_access_total",
      help,
      labels: { cache, outcome: "hit" },
      value: hits,
    });
    points.push({
      name: "readwise_cache_access_total",
      help,
      labels: { cache, outcome: "miss" },
      value: misses,
    });
  }
  return points;
}

export function getMetricsSnapshot(): MetricsSnapshot {
  const counterPoints: CounterPoint[] = [];
  for (const [key, value] of counters) {
    const [name] = key.split("|");
    counterPoints.push({ name, help: value.help, labels: { ...value.labels }, value: value.value });
  }
  counterPoints.push(...cacheCounterPoints());

  const histogramPoints: HistogramPoint[] = [];
  for (const [key, value] of histograms) {
    const [name] = key.split("|");
    histogramPoints.push({
      name,
      help: value.help,
      labels: { ...value.labels },
      buckets: value.buckets.map((le, i) => ({ le, count: value.counts[i] })),
      count: value.count,
      sum: value.sum,
    });
  }

  const byNameAndLabels = (a: { name: string; labels: Record<string, string> }, b: { name: string; labels: Record<string, string> }) =>
    `${a.name}|${labelsKey(a.labels)}`.localeCompare(`${b.name}|${labelsKey(b.labels)}`);

  return {
    counters: counterPoints.sort(byNameAndLabels),
    histograms: histogramPoints.sort(byNameAndLabels),
  };
}

function escapePrometheusValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function renderLabels(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  return `{${keys.map((key) => `${key}="${escapePrometheusValue(labels[key])}"`).join(",")}}`;
}

export function exportMetricsPrometheus(): string {
  const snapshot = getMetricsSnapshot();
  const lines: string[] = [];
  const emitted = new Set<string>();
  for (const counter of snapshot.counters) {
    if (!emitted.has(counter.name)) {
      lines.push(`# HELP ${counter.name} ${counter.help}`);
      lines.push(`# TYPE ${counter.name} counter`);
      emitted.add(counter.name);
    }
    lines.push(`${counter.name}${renderLabels(counter.labels)} ${counter.value}`);
  }

  for (const histogram of snapshot.histograms) {
    if (!emitted.has(histogram.name)) {
      lines.push(`# HELP ${histogram.name} ${histogram.help}`);
      lines.push(`# TYPE ${histogram.name} histogram`);
      emitted.add(histogram.name);
    }
    for (const bucket of histogram.buckets) {
      lines.push(`${histogram.name}_bucket${renderLabels({ ...histogram.labels, le: String(bucket.le) })} ${bucket.count}`);
    }
    lines.push(`${histogram.name}_bucket${renderLabels({ ...histogram.labels, le: "+Inf" })} ${histogram.count}`);
    lines.push(`${histogram.name}_sum${renderLabels(histogram.labels)} ${histogram.sum}`);
    lines.push(`${histogram.name}_count${renderLabels(histogram.labels)} ${histogram.count}`);
  }
  return `${lines.join("\n")}\n`;
}

export function resetMetrics(): void {
  counters.clear();
  histograms.clear();
  cacheStats.clear();
}
