/**
 * Client-safe option registries and label metadata.
 *
 * Single source of truth for product option values, labels, colors, and UI
 * metadata that must be available in the browser. NO server-only imports
 * (no Prisma, AI, logger, runtime config, or Node APIs).
 *
 * Server modules that previously inlined these constants should import from
 * here instead, keeping the values consistent across all contexts.
 */

// ---------------------------------------------------------------------------
// CEFR level registry
// ---------------------------------------------------------------------------

/** All six CEFR levels in ascending order (A1 … C2). */
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

/** Human-readable label for each CEFR level (e.g. "B1 · Intermediate"). */
export const LEVEL_HINTS: Record<string, string> = {
  A1: "A1 · Beginner",
  A2: "A2 · Elementary",
  B1: "B1 · Intermediate",
  B2: "B2 · Upper-intermediate",
  C1: "C1 · Advanced",
  C2: "C2 · Proficient",
};

export function isCefrLevel(value: unknown): value is CefrLevel {
  return typeof value === "string" && (CEFR_LEVELS as readonly string[]).includes(value);
}

// ENGLISH_LEVELS is the same CEFR scale used in reader profiles.
export const ENGLISH_LEVELS = CEFR_LEVELS;
export type EnglishLevel = CefrLevel;

// ---------------------------------------------------------------------------
// Demographic profile option registries
// ---------------------------------------------------------------------------

export const AGE_RANGES = [
  "Under 18",
  "18-24",
  "25-34",
  "35-44",
  "45-54",
  "55+",
] as const;
export type AgeRange = (typeof AGE_RANGES)[number];

export const GENDERS = [
  "Female",
  "Male",
  "Non-binary",
  "Other",
  "Prefer not to say",
] as const;
export type Gender = (typeof GENDERS)[number];

export const DAILY_GOAL_MIN = 1;
export const DAILY_GOAL_MAX = 10;
export const DAILY_GOAL_DEFAULT = 2;

// ---------------------------------------------------------------------------
// Frequency tier registry
// ---------------------------------------------------------------------------

export type FrequencyTier = "top1k" | "top5k" | "academic";

/** Human-readable label for a frequency tier. */
export const TIER_LABELS: Record<FrequencyTier, string> = {
  top1k: "Top 1K",
  top5k: "Top 5K",
  academic: "Academic",
};

/** Badge variant for each tier (maps to ui/Badge variants). */
export const TIER_VARIANTS: Record<FrequencyTier, "success" | "primary" | "warning"> = {
  top1k: "success",
  top5k: "primary",
  academic: "warning",
};

export function isFrequencyTier(value: unknown): value is FrequencyTier {
  return value === "top1k" || value === "top5k" || value === "academic";
}
