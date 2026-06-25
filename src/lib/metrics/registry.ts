/**
 * Core in-process metrics registry.
 *
 * Owns the shared counter/histogram/cache-stat maps, label normalization, and
 * snapshot generation. Domain recorders call the primitives exported here;
 * nothing else should touch the maps directly.
 *
 * Label safety: user ids, request ids, raw article ids, full paths, prompts,
 * selected text, IPs, and other unbounded values must NEVER appear as labels.
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

export const API_DURATION_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
export const AI_DURATION_BUCKETS_MS = [100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];
export const JOB_DURATION_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 15000, 30000, 120000];

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

export function normalizeLabelValue(value: MetricLabelValue, fallback = "unknown"): string {
  const raw = String(value ?? fallback).trim();
  if (!raw) return fallback;
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9_.:/[\]-]+/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 80) || fallback
  );
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

/** Normalize an outcome string against an allowed list, returning "unknown" for unrecognised values. */
export function normalizeOutcome(value: string, allowed: readonly string[]): string {
  return allowed.includes(value) ? value : "unknown";
}

/** Coarsen an HTTP status code to its class string (e.g. 201 → "2xx"). */
export function statusClass(status: number | string): string {
  const n = typeof status === "number" ? status : Number(status);
  if (!Number.isFinite(n) || n <= 0) return "unknown";
  return `${Math.floor(n / 100)}xx`;
}

/** Increment a counter by `amount` (default 1), creating the series on first use. */
export function incCounter(
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

/** Record a single observation against a histogram, creating the series on first use. */
export function observeHistogram(
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

/** Track a cache lookup (always called on every access). */
export function incCacheLookup(name: string): void {
  const current = cacheStats.get(name) ?? { lookups: 0, misses: 0 };
  current.lookups++;
  cacheStats.set(name, current);
}

/** Track a cache miss (called only when the lookup was a miss). */
export function incCacheMiss(name: string): void {
  const current = cacheStats.get(name) ?? { lookups: 0, misses: 0 };
  current.misses++;
  cacheStats.set(name, current);
}

function cacheCounterPoints(): CounterPoint[] {
  const help = "Cache accesses by cache name and derived hit/miss outcome.";
  const points: CounterPoint[] = [];
  for (const [cache, stats] of cacheStats) {
    const misses = Math.max(0, stats.misses);
    const hits = Math.max(0, stats.lookups - stats.misses);
    points.push({ name: "readwise_cache_access_total", help, labels: { cache, outcome: "hit" }, value: hits });
    points.push({ name: "readwise_cache_access_total", help, labels: { cache, outcome: "miss" }, value: misses });
  }
  return points;
}

const byNameAndLabels = (
  a: { name: string; labels: Record<string, string> },
  b: { name: string; labels: Record<string, string> },
) =>
  `${a.name}|${Object.keys(a.labels).sort().map((k) => `${k}=${a.labels[k]}`).join(",")}`
    .localeCompare(
      `${b.name}|${Object.keys(b.labels).sort().map((k) => `${k}=${b.labels[k]}`).join(",")}`,
    );

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

  return {
    counters: counterPoints.sort(byNameAndLabels),
    histograms: histogramPoints.sort(byNameAndLabels),
  };
}

export function resetMetrics(): void {
  counters.clear();
  histograms.clear();
  cacheStats.clear();
}
