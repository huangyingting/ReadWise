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