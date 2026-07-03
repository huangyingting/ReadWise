/**
 * Shared primitives for the learning-mastery subsystem (REF-028).
 *
 * Value objects: bounded scores, evidence summaries.
 * Shared helpers: score clamping, best-effort mastery wrapping, JSON column
 * parsing.  These are the foundation imported by every other module in
 * `src/lib/learning/`; they must stay pure (no Prisma, no I/O).
 */

import { createLogger } from "@/lib/observability/logger";

const log = createLogger("learning");
const SCORE_MIN = 0;
const SCORE_MAX = 1;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Clamps a number into the inclusive 0–1 range (NaN → 0). */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return SCORE_MIN;
  if (value < SCORE_MIN) return SCORE_MIN;
  if (value > SCORE_MAX) return SCORE_MAX;
  return value;
}

/**
 * Runs a mastery side-effect as strictly best-effort. A thrown error is
 * swallowed and logged at `warn` (the primary user action already succeeded),
 * and the caller receives `null` instead of an exception. Use this to wrap
 * every mastery update made from a route/lib so bookkeeping can never break the
 * request it hangs off of.
 */
export async function bestEffortMastery<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    log.warn("mastery.side_effect_failed", {
      label,
      error: errorMessage(err),
    });
    return null;
  }
}

/**
 * Parses a JSON column that should hold a `string[]`. Accepts native Prisma
 * `Json` arrays or null — always returning a clean `string[]`.
 */
export function parseStringArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter(isString);
  }
  return [];
}
