/** Shared pure aggregation helpers for analytics and dashboards. */

export type WeekBucket = {
  /** ISO YYYY-[W]WW label, e.g. "2025-W23". */
  week: string;
  count: number;
};

/** Percentage helper. Returns 0 for empty denominators. */
export function percentage(
  numerator: number,
  denominator: number,
  precision = 1,
): number {
  if (denominator <= 0) return 0;
  const factor = 10 ** Math.max(0, precision);
  return Math.round((numerator / denominator) * 100 * factor) / factor;
}

/** Whole-number percentage helper for compact dashboards. */
export function wholePercentage(numerator: number, denominator: number): number {
  return percentage(numerator, denominator, 0);
}

/** Rounded arithmetic mean, or null for an empty series. */
export function averageRounded(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / values.length);
}

/** ISO year+week string e.g. "2025-W03" for any Date. */
export function isoWeek(dateLike: Date): string {
  const date = new Date(Date.UTC(
    dateLike.getUTCFullYear(),
    dateLike.getUTCMonth(),
    dateLike.getUTCDate(),
  ));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/** Produce a zero-filled series of weekly buckets for the last N weeks. */
export function lastNWeeks(n: number, now: Date = new Date()): WeekBucket[] {
  const buckets: WeekBucket[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 7 * 86_400_000);
    buckets.push({ week: isoWeek(d), count: 0 });
  }
  return buckets;
}

/** Merge raw date+count pairs into pre-built weekly buckets. */
export function fillWeekBuckets(
  buckets: WeekBucket[],
  rows: { date: Date; count: number }[],
): WeekBucket[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = isoWeek(r.date);
    map.set(key, (map.get(key) ?? 0) + r.count);
  }
  return buckets.map((b) => ({ ...b, count: map.get(b.week) ?? 0 }));
}

/**
 * Merges a groupBy result into an ordered registry of `{ key, label, count }`
 * buckets. All DB rows whose key matches a registry entry are placed in that
 * entry's bucket; everything else (including null keys and unregistered values)
 * is accumulated as a single "spillover" bucket appended at the end.
 *
 * @param registry   Ordered list of known keys + display labels.
 * @param rows       Raw groupBy rows — each must supply a `key` and `count`.
 * @param getKey     Extracts the groupBy dimension value from a raw row.
 * @param getCount   Extracts the count value from a raw row (default: `_all`).
 * @param spillover  Label for the catch-all overflow bucket. Pass `null` to
 *                   suppress the spillover entirely.
 */
export function bucketize<K extends { key: string; label: string }>(
  registry: readonly K[],
  rows: { key: string | null; count: number }[],
  spillover: { key: string; label: string } | null = { key: "other", label: "Other" },
): (K & { count: number })[] {
  const countByKey = new Map<string | null, number>();
  for (const r of rows) {
    countByKey.set(r.key, (countByKey.get(r.key) ?? 0) + r.count);
  }

  const result: (K & { count: number })[] = registry.map((entry) => ({
    ...entry,
    count: countByKey.get(entry.key) ?? 0,
  }));

  if (spillover !== null) {
    const knownKeys = new Set(registry.map((e) => e.key));
    let extra = 0;
    for (const [k, v] of countByKey) {
      if (k === null || !knownKeys.has(k)) extra += v;
    }
    if (extra > 0) {
      result.push({ ...(spillover as K), count: extra });
    }
  }

  return result;
}