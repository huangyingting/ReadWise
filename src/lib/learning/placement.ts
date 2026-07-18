/** Client-safe Placement seed-level helpers. */

import { levelRank } from "@/lib/leveling/cefr-primitives";

/** Self-reported seed levels a placement passage can be keyed to. */
export const PLACEMENT_SEED_LEVELS = ["A2", "B1", "B2"] as const;
export type PlacementSeedLevel = (typeof PLACEMENT_SEED_LEVELS)[number];

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
