/**
 * Client-safe display formatting helpers (REF-083).
 *
 * Pure functions — no server-only imports. Safe to use in both server
 * components and client components.
 *
 * Locale assumptions: en / en-US throughout until full localization lands.
 */

/** Placeholder returned for null / invalid inputs. */
const DASH = "—";

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Formats a Date, ISO string, or null as "Jan 1, 2026"
 * (en-US — year numeric, month short, day numeric).
 * Returns "—" for null / undefined / invalid dates.
 */
export function formatShortDate(d: Date | string | null | undefined): string {
  if (d == null) return DASH;
  const date = d instanceof Date ? d : new Date(d as string);
  if (isNaN(date.getTime())) return DASH;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Formats a Date or ISO string as "Jan 2026"
 * (en-US — month short, year numeric).
 */
export function formatMonthYear(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d as string);
  return date.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

/**
 * Formats a YYYY-MM-DD string as "January 1, 2026"
 * (en-US — month long, day numeric, year numeric, UTC timezone).
 *
 * Treats the string as a UTC calendar date so that timezone offsets do not
 * shift the displayed day.
 */
export function formatUTCDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Formats a Date as a medium date string using the "en" locale.
 * e.g. "Jun 24, 2026".
 * Returns null when the input is null.
 */
export function formatMediumDate(d: Date | null): string | null {
  if (!d) return null;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(d);
}

/**
 * Formats a Date as "Jun 24" (en-US — month short, day numeric).
 */
export function formatShortMonthDay(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Formats a Date or ISO string as a locale date-time string via toLocaleString().
 * Returns "—" for null / undefined.
 */
export function formatDateTime(d: Date | string | null | undefined): string {
  if (d == null) return DASH;
  const date = d instanceof Date ? d : new Date(d as string);
  if (isNaN(date.getTime())) return DASH;
  return date.toLocaleString();
}

/**
 * Formats a Date as the full weekday name in UTC, e.g. "Sunday".
 * (en-US — weekday long, UTC timezone.)
 */
export function formatWeekdayUTC(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

// ---------------------------------------------------------------------------
// Duration / age helpers
// ---------------------------------------------------------------------------

/**
 * Formats a lock / job age in milliseconds as a compact human string.
 * e.g. 30 000 ms → "30s", 90 000 ms → "2m", 7 200 000 ms → "2h".
 * Returns "—" for null / undefined.
 */
export function formatLockAge(ms: number | null | undefined): string {
  if (ms == null) return DASH;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

/**
 * Formats an ISO date string as a human-readable relative time.
 *
 * Tiers (all computed from Date.now()):
 *   < 60 s       → "Just now"
 *   < 60 min     → "${n} min ago"
 *   < 24 h       → "${n}h ago"
 *   1 day        → "Yesterday"
 *   2 – 6 days   → "${n} days ago"
 *   ≥ 7 days     → short month+day via formatShortMonthDay, e.g. "Jun 24"
 */
export function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;
  return formatShortMonthDay(d);
}

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

/**
 * Formats a USD amount.
 * Values < 1 use 4 decimal places (e.g. "$0.0012"); otherwise 2 (e.g. "$1.50").
 */
export function formatUSD(value: number): string {
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}
