/**
 * Pure platform primitives barrel — `@/lib/primitives/pure`
 *
 * @boundary pure — no DOM, no `node:*`, no server-only APIs.
 * Safe to import in browser, Node.js, and edge runtimes.
 *
 * Canonical import paths remain stable; these re-exports are provided for
 * discoverability and boundary documentation only.
 * See src/lib/primitives/README.md for the full classification.
 */

// ── Math / numeric helpers ───────────────────────────────────────────────────
/** Clamps a number into the inclusive 0–1 range (NaN → 0). */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// ── Aggregation math (analytics, dashboards) ────────────────────────────────
export {
  type WeekBucket,
  percentage,
  wholePercentage,
  averageRounded,
  isoWeek,
  lastNWeeks,
  fillWeekBuckets,
} from "@/lib/aggregation";

// ── Retry / backoff ──────────────────────────────────────────────────────────
export {
  type JitteredBackoffOptions,
  jitteredExponentialBackoff,
} from "@/lib/backoff";

// ── Security-sensitive: XSS-safe JSON for <script> injection ────────────────
export { safeJsonStringify } from "@/lib/safe-json";

// ── Display formatting ────────────────────────────────────────────────────────
export { formatRelative } from "@/lib/format-relative";

// ── Input validation ──────────────────────────────────────────────────────────
export {
  validateListName,
  LIST_NAME_MAX_LENGTH,
} from "@/lib/list-name-validation";
