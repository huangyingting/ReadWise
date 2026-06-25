/** Profile value definitions and labels shared by onboarding, settings, and API. */

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
  "Other",
  "Prefer not to say",
] as const;

export const ENGLISH_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export type AgeRange = (typeof AGE_RANGES)[number];
export type Gender = (typeof GENDERS)[number];
export type EnglishLevel = (typeof ENGLISH_LEVELS)[number];

/** Human-readable labels for each CEFR level (e.g. "B1 · Intermediate"). */
export const LEVEL_HINTS: Record<string, string> = {
  A1: "A1 · Beginner",
  A2: "A2 · Elementary",
  B1: "B1 · Intermediate",
  B2: "B2 · Upper-intermediate",
  C1: "C1 · Advanced",
  C2: "C2 · Proficient",
};

export const DAILY_GOAL_MIN = 1;
export const DAILY_GOAL_MAX = 10;
export const DAILY_GOAL_DEFAULT = 2;
