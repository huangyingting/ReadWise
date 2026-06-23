/**
 * Shared helpers for the durable learning-mastery models (Epic RW-E007).
 *
 * The Word / Article / Skill mastery tables are derived, best-effort caches of
 * how well a user knows a word, an article, or a skill. They complement (never
 * replace) the raw activity tables they are computed from. Because mastery is
 * only an analytics/recommendation aid, EVERY update is a best-effort
 * side-effect: a failure here must NEVER break the underlying user action
 * (saving progress, looking a word up, finishing a quiz, …).
 */

import { createLogger } from "@/lib/logger";

const log = createLogger("mastery");

/** Clamps a number into the inclusive 0–1 range (NaN → 0). */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
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
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Parses a JSON/string column that should hold a `string[]`. Tolerates a
 * native JSON array (Prisma `Json`), a JSON-encoded string (legacy/SQLite), or
 * null — always returning a clean `string[]`.
 */
export function parseStringArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string");
      }
    } catch {
      // fall through
    }
  }
  return [];
}
