/**
 * Profile domain: value definitions, schema validation, and database access.
 *
 * Value definitions and schema are now maintained in the profile-preferences
 * subsystem and re-exported here for backward compatibility with existing
 * imports in API routes and tests.
 */
import { prisma } from "@/lib/prisma";
import type { Profile } from "@prisma/client";

// Re-export value definitions and schema from the profile-preferences subsystem.
// Import directly from the TS-only modules (not the barrel index) so that
// Node.js test runners that strip TypeScript but cannot process TSX do not
// attempt to load the React UI components.
export {
  AGE_RANGES,
  GENDERS,
  ENGLISH_LEVELS,
  LEVEL_HINTS,
  DAILY_GOAL_MIN,
  DAILY_GOAL_MAX,
  DAILY_GOAL_DEFAULT,
  type AgeRange,
  type Gender,
  type EnglishLevel,
} from "@/features/profile-preferences/values";
export {
  type ProfileInput,
  type ProfileInputResult,
  parseProfileInput,
  parseTopics,
} from "@/features/profile-preferences/schema";

// Database access helpers (server-side only; require Prisma).

export function getProfile(userId: string): Promise<Profile | null> {
  return prisma.profile.findUnique({ where: { userId } });
}

export function isOnboarded(profile: Profile | null): boolean {
  return Boolean(profile?.completedAt);
}

export async function isUserOnboarded(userId: string): Promise<boolean> {
  return isOnboarded(await getProfile(userId));
}
