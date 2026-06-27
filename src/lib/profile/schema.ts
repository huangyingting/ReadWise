/**
 * Shared profile input schema and validation.
 * Used by /api/profile, /api/onboarding, and any settings/onboarding form
 * that needs to validate or normalize profile data before submission.
 */
import type { Prisma } from "@prisma/client";
import { isValidCategorySlug } from "@/lib/categories";
import { isGoalPath, type GoalPath } from "@/lib/learning/goal-path";
import {
  ENGLISH_LEVELS,
  AGE_RANGES,
  GENDERS,
  DAILY_GOAL_MIN,
  DAILY_GOAL_MAX,
  type AgeRange,
  type Gender,
  type EnglishLevel,
} from "@/lib/option-registries";

export type ProfileInput = {
  ageRange: AgeRange | null;
  gender: Gender | null;
  englishLevel: EnglishLevel;
  topics: string[];
  /** Articles-per-day target. Present only when explicitly supplied in the request body. */
  dailyGoal?: number;
  /**
   * Goal Paths (#809). Controlled reading-strategy path. Present only when the
   * key is supplied: a valid path sets it, `null` clears it, omission leaves the
   * stored value untouched (mirrors the `dailyGoal` opt-in pattern).
   */
  goalPath?: GoalPath | null;
};

export type ProfileInputResult =
  | { ok: true; value: ProfileInput }
  | { ok: false; error: string };

export function parseProfileInput(body: {
  ageRange?: unknown;
  gender?: unknown;
  englishLevel?: unknown;
  topics?: unknown;
  dailyGoal?: unknown;
  goalPath?: unknown;
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

  let dailyGoal: number | undefined;
  if (body.dailyGoal != null) {
    const raw = body.dailyGoal;
    if (
      typeof raw !== "number" ||
      !Number.isInteger(raw) ||
      raw < DAILY_GOAL_MIN ||
      raw > DAILY_GOAL_MAX
    ) {
      return {
        ok: false,
        error: `Daily goal must be an integer between ${DAILY_GOAL_MIN} and ${DAILY_GOAL_MAX}`,
      };
    }
    dailyGoal = raw;
  }

  // Goal Paths (#809): opt-in like dailyGoal. Only validate/forward when the
  // key is present; `null`/`""` clears, any non-controlled value is a 400.
  let goalPath: GoalPath | null | undefined;
  if ("goalPath" in body && body.goalPath !== undefined) {
    const raw = body.goalPath;
    if (raw === null || raw === "") {
      goalPath = null;
    } else if (isGoalPath(raw)) {
      goalPath = raw;
    } else {
      return { ok: false, error: "Invalid reading goal path" };
    }
  }

  return {
    ok: true,
    value: {
      ageRange,
      gender,
      englishLevel: englishLevel as EnglishLevel,
      topics,
      ...(dailyGoal !== undefined ? { dailyGoal } : {}),
      ...(goalPath !== undefined ? { goalPath } : {}),
    },
  };
}

export function parseTopics(topics: Prisma.JsonValue | null | undefined): string[] {
  if (topics == null) {
    return [];
  }

  if (Array.isArray(topics)) {
    return topics.filter((t): t is string => typeof t === "string");
  }

  return [];
}
