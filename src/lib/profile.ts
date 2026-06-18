import { prisma } from "@/lib/prisma";
import type { Profile } from "@prisma/client";
import { isValidCategorySlug } from "@/lib/categories";

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

export type ProfileInput = {
  ageRange: AgeRange | null;
  gender: Gender | null;
  englishLevel: EnglishLevel;
  topics: string[];
};

export type ProfileInputResult =
  | { ok: true; value: ProfileInput }
  | { ok: false; error: string };

export function parseProfileInput(body: {
  ageRange?: unknown;
  gender?: unknown;
  englishLevel?: unknown;
  topics?: unknown;
}): ProfileInputResult {
  const englishLevel = body.englishLevel;
  if (
    typeof englishLevel !== "string" ||
    !ENGLISH_LEVELS.includes(englishLevel as EnglishLevel)
  ) {
    return { ok: false, error: "A valid English level (A1-C2) is required" };
  }

  let ageRange: AgeRange | null = null;
  if (body.ageRange != null && body.ageRange !== "") {
    if (
      typeof body.ageRange !== "string" ||
      !AGE_RANGES.includes(body.ageRange as AgeRange)
    ) {
      return { ok: false, error: "Invalid age range" };
    }
    ageRange = body.ageRange as AgeRange;
  }

  let gender: Gender | null = null;
  if (body.gender != null && body.gender !== "") {
    if (
      typeof body.gender !== "string" ||
      !GENDERS.includes(body.gender as Gender)
    ) {
      return { ok: false, error: "Invalid gender" };
    }
    gender = body.gender as Gender;
  }

  const rawTopics = Array.isArray(body.topics) ? body.topics : [];
  const topics = Array.from(
    new Set(
      rawTopics.filter(
        (t): t is string => typeof t === "string" && isValidCategorySlug(t),
      ),
    ),
  );

  return {
    ok: true,
    value: { ageRange, gender, englishLevel: englishLevel as EnglishLevel, topics },
  };
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
