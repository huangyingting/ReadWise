/**
 * Time-range types, presets, and the concrete window resolver for product
 * analytics dashboards.
 */
import type { AnalyticsSegment } from "@/lib/analytics/queries/segments";

export type AnalyticsTimeRange = {
  /** Inclusive lower bound on occurredAt. */
  since?: Date | null;
  /** Exclusive upper bound on occurredAt. */
  until?: Date | null;
};

/** Selectable look-back windows (days) for the dashboard time-range control. */
export const TIME_RANGE_PRESETS: readonly { days: number; label: string }[] = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 365, label: "Last 12 months" },
];

const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 365;

/**
 * Resolves a `days` look-back into a concrete `{ since, until }` window ending
 * at `now`. Clamps to a sane range so a hostile query can't scan forever.
 */
export function resolveTimeRange(
  days: number | null | undefined,
  now: Date = new Date(),
): { since: Date; until: Date; days: number } {
  const clamped =
    Number.isFinite(days) && (days ?? 0) > 0
      ? Math.min(MAX_RANGE_DAYS, Math.floor(days as number))
      : DEFAULT_RANGE_DAYS;
  const until = now;
  const since = new Date(now.getTime() - clamped * 24 * 60 * 60 * 1000);
  return { since, until, days: clamped };
}

export type ParsedAnalyticsQuery = {
  /** Look-back window clamped to [1, 365]; defaults to 30. */
  days: number;
  /** Active segment filter, or undefined when no level/topic is set. */
  segment?: AnalyticsSegment;
};

/**
 * Parses the shared analytics query parameters (`days`, `level`, `topic`)
 * from a plain record of optional string values. Accepted by both the admin
 * analytics page (which uses a server-component `searchParams` object) and
 * the analytics export API route (which passes URLSearchParams values).
 *
 * Single authoritative `days` clamp: invalid/missing → 30; valid → clamped
 * to [1, 365]. `resolveTimeRange` provides the final floor via
 * `DEFAULT_RANGE_DAYS` but this ensures the consumer always receives a sane
 * numeric value before calling it.
 */
export function parseAnalyticsQuery(params: {
  days?: string | null;
  level?: string | null;
  topic?: string | null;
}): ParsedAnalyticsQuery {
  const rawDays = Number.parseInt(params.days ?? "", 10);
  const days =
    Number.isFinite(rawDays) && rawDays >= 1
      ? Math.min(MAX_RANGE_DAYS, rawDays)
      : DEFAULT_RANGE_DAYS;
  const level = (params.level ?? "").trim();
  const topic = (params.topic ?? "").trim();
  const segment: AnalyticsSegment | undefined =
    level || topic ? { level: level || null, topic: topic || null } : undefined;
  return { days, segment };
}
