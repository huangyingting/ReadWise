/**
 * Server-side data helpers for the Progress page (#96, #97).
 * Kept separate from learner-analytics to avoid bloating that module.
 */

import { prisma } from "@/lib/prisma";
import type { EnglishLevel } from "@/lib/option-registries";

// ---------------------------------------------------------------------------
// Level history (#97)
// ---------------------------------------------------------------------------

export type LevelEntry = {
  level: EnglishLevel;
  changedAt: string; // ISO string — safe to serialize
};

const LEVEL_HISTORY_LIMIT = 100;

type LevelHistoryRow = {
  level: string;
  changedAt: Date;
};

function toLevelEntry(row: LevelHistoryRow): LevelEntry {
  return {
    level: row.level as EnglishLevel,
    changedAt: row.changedAt.toISOString(),
  };
}

/**
 * Returns the user's CEFR level history, oldest first.
 * Bounded to the most recent 100 rows (more than enough for any user).
 */
export async function getLevelHistory(userId: string): Promise<LevelEntry[]> {
  const rows = await prisma.levelHistory.findMany({
    where: { userId },
    orderBy: { changedAt: "asc" },
    select: { level: true, changedAt: true },
    take: LEVEL_HISTORY_LIMIT,
  });
  return rows.map(toLevelEntry);
}

/**
 * Returns the user's current CEFR level from their profile.
 * Returns null if no profile exists yet (shouldn't happen after onboarding).
 */
export async function getCurrentLevel(userId: string): Promise<EnglishLevel | null> {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { englishLevel: true },
  });
  return (profile?.englishLevel as EnglishLevel) ?? null;
}
