/**
 * CEFR primitives — pure, client-safe rank/range utilities.
 *
 * Single source of truth for CEFR rank ordering, range queries, and type
 * guards. All functions are PURE (no DB, no I/O). Labels and constants come
 * from the option-registries (REF-084); this module adds the COMPUTATION layer
 * so that `difficulty.ts`, `placement.ts`, and the leveling subsystem can share
 * the same rank arithmetic without each defining its own level array.
 *
 * Consumers that currently import `levelRank`, `levelsAtOrBelow`, or
 * `isDifficultyLevel` from `@/lib/difficulty` may switch to importing from
 * here; `difficulty.ts` re-exports them for backward compatibility.
 */

import {
  CEFR_LEVELS,
  ENGLISH_LEVELS,
  LEVEL_HINTS,
  isCefrLevel,
  type CefrLevel,
  type EnglishLevel,
} from "@/lib/option-registries";

export {
  CEFR_LEVELS,
  ENGLISH_LEVELS,
  LEVEL_HINTS,
  isCefrLevel,
  type CefrLevel,
  type EnglishLevel,
};

/**
 * Ordinal rank of a CEFR level (A1 = 0 … C2 = 5). Returns -1 for unknown
 * values. Used to sort and compare levels numerically.
 */
export function levelRank(level: string): number {
  return (ENGLISH_LEVELS as readonly string[]).indexOf(level);
}

/**
 * Returns every CEFR level at or below `maxLevel` (inclusive), in ascending
 * order. Useful for building DB `difficulty IN (...)` filters that keep
 * level-appropriate articles without loading the whole corpus into memory.
 * Returns an empty array for an unknown level.
 */
export function levelsAtOrBelow(maxLevel: EnglishLevel): EnglishLevel[] {
  const max = levelRank(maxLevel);
  if (max < 0) return [];
  return ENGLISH_LEVELS.filter((_, i) => i <= max);
}

/**
 * Type guard: returns true when `value` is a valid CEFR level string.
 */
export function isDifficultyLevel(value: unknown): value is EnglishLevel {
  return (
    typeof value === "string" &&
    (ENGLISH_LEVELS as readonly string[]).includes(value)
  );
}
