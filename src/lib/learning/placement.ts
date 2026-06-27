/**
 * Lightweight reading-placement scoring (#806).
 *
 * PURE — no Prisma, no I/O, client-safe. Turns a placement attempt's structured
 * outcome (correct/total answers + vocabulary-lookup pressure relative to the
 * passage length) into a deterministic recommended starting CEFR level.
 *
 * Privacy: this module only ever sees COUNTS and a controlled seed level — never
 * passage text, question text, answer text, or looked-up words. The bucketing is
 * deterministic so the same inputs always yield the same recommendation and the
 * route + tests can reason about it without a DB.
 *
 * Design (roadmap §1, #806):
 *   correctRatio = correct / total
 *   lookupRate   = lookups / wordCount
 *   - high comprehension + low vocab pressure  → one level ABOVE seed
 *   - low comprehension OR high vocab pressure → one level BELOW seed
 *   - otherwise                                → keep seed
 * Evaluated low-confidence-first so a heavy vocabulary load can never be
 * out-voted into an over-placement (cold-start conservatism).
 */

import {
  ENGLISH_LEVELS,
  levelRank,
  isDifficultyLevel,
  type EnglishLevel,
} from "@/lib/leveling/cefr-primitives";

/** Self-reported seed levels a placement passage can be keyed to. */
export const PLACEMENT_SEED_LEVELS = ["A2", "B1", "B2"] as const;
export type PlacementSeedLevel = (typeof PLACEMENT_SEED_LEVELS)[number];

/** Recommended levels the scorer can return (one below A2 … one above B2). */
export const PLACEMENT_RECOMMENDED_MIN_RANK = levelRank("A1"); // 0
export const PLACEMENT_RECOMMENDED_MAX_RANK = levelRank("C1"); // 4
/** Comprehension at/above which the learner may be nudged UP a level. */
export const PLACEMENT_HIGH_CORRECT_RATIO = 0.8;
/** Comprehension below which the learner is nudged DOWN a level. */
export const PLACEMENT_LOW_CORRECT_RATIO = 0.6;
/** Lookup rate that must be undercut to earn the UP nudge. */
export const PLACEMENT_LOW_LOOKUP_RATE = 0.05;
/** Lookup rate at/above which vocabulary pressure forces a DOWN nudge. */
export const PLACEMENT_HIGH_LOOKUP_RATE = 0.1;

/** Type guard for the controlled seed-level set. */
export function isPlacementSeedLevel(value: unknown): value is PlacementSeedLevel {
  return (
    typeof value === "string" &&
    (PLACEMENT_SEED_LEVELS as readonly string[]).includes(value)
  );
}

/**
 * Maps any profile CEFR level onto the nearest placement seed band
 * (`A2` | `B1` | `B2`). A1/A2 (and unknown) seed at A2; B1 seeds at B1;
 * B2 and above seed at B2. Pure — used to pick a passage for retakes.
 */
export function seedLevelForProfile(
  level: string | null | undefined,
): PlacementSeedLevel {
  const rank = level ? levelRank(level) : -1;
  if (rank <= levelRank("A2")) return "A2"; // A1, A2, or unknown
  if (rank === levelRank("B1")) return "B1";
  return "B2"; // B2, C1, C2
}

/**
 * Deterministic placement bucketing. Returns the level offset relative to the
 * seed: `-1` (below), `0` (hold), or `+1` (above).
 *
 * Evaluated conservatively: the DOWN condition is checked first so a high
 * lookup rate cannot be masked by a high correct ratio.
 */
function placementOffset(correctRatio: number, lookupRate: number): -1 | 0 | 1 {
  if (correctRatio < PLACEMENT_LOW_CORRECT_RATIO || lookupRate >= PLACEMENT_HIGH_LOOKUP_RATE) {
    return -1;
  }
  if (correctRatio >= PLACEMENT_HIGH_CORRECT_RATIO && lookupRate < PLACEMENT_LOW_LOOKUP_RATE) {
    return 1;
  }
  return 0;
}

/**
 * Pure placement scorer. Given the seed level the passage was keyed to and the
 * structured attempt outcome, returns a recommended starting CEFR level
 * (`A1`…`C1`).
 *
 * Guards: a non-positive `total` scores as zero comprehension (→ below); a
 * non-positive `wordCount` is treated as no vocabulary pressure (lookupRate 0).
 * Seed levels are constrained to `A2`–`B1`–`B2` and the offset to ±1, so the
 * result is always within the recommendable `A1`…`C1` window.
 *
 * @param seedLevel   Controlled seed level the passage was chosen for.
 * @param correct     Number of correct answers (count only).
 * @param total       Number of questions presented (count only).
 * @param lookups     Vocabulary lookups during the read (count only).
 * @param wordCount   Passage length in words.
 */
export function computePlacementScore(
  seedLevel: PlacementSeedLevel,
  correct: number,
  total: number,
  lookups: number,
  wordCount: number,
): EnglishLevel {
  const correctRatio = total > 0 ? correct / total : 0;
  const lookupRate = wordCount > 0 ? lookups / wordCount : 0;

  const offset = placementOffset(correctRatio, lookupRate);
  const targetRank = levelRank(seedLevel) + offset;
  return ENGLISH_LEVELS[targetRank];
}

export { isDifficultyLevel };
