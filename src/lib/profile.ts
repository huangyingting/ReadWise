import { prisma } from "@/lib/prisma";
import type { Profile } from "@prisma/client";

export const AGE_RANGES = [
  "Under 18",
  "18-24",
  "25-34",
  "35-44",
  "45-54",
  "55+",
] as const;

export const GENDERS = [
  "Female",
  "Male",
  "Non-binary",
  "Prefer not to say",
] as const;

export const ENGLISH_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export type AgeRange = (typeof AGE_RANGES)[number];
export type Gender = (typeof GENDERS)[number];
export type EnglishLevel = (typeof ENGLISH_LEVELS)[number];

export function getProfile(userId: string): Promise<Profile | null> {
  return prisma.profile.findUnique({ where: { userId } });
}

export function isOnboarded(profile: Profile | null): boolean {
  return Boolean(profile?.completedAt);
}

export async function isUserOnboarded(userId: string): Promise<boolean> {
  return isOnboarded(await getProfile(userId));
}

export function parseTopics(topics: string | null | undefined): string[] {
  if (!topics) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(topics);
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === "string");
    }
  } catch {
    // ignore malformed JSON and fall through
  }
  return [];
}
