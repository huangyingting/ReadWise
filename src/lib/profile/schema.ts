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

type ProfileInputBody = {
  ageRange?: unknown;
  gender?: unknown;
  englishLevel?: unknown;
  topics?: unknown;
  dailyGoal?: unknown;
  goalPath?: unknown;
};

type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isAllowedValue<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
): value is T {
  return typeof value === "string" && allowedValues.includes(value as T);
}

function parseOptionalControlledValue<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  error: string,
): FieldResult<T | null> {
  if (value == null || value === "") {
    return { ok: true, value: null };
  }

  if (!isAllowedValue(value, allowedValues)) {
    return { ok: false, error };
  }

  return { ok: true, value };
}

function parseTopicSlugs(topics: unknown): string[] {
  const rawTopics = Array.isArray(topics) ? topics : [];
  return Array.from(
    new Set(
      rawTopics.filter(
        (topic): topic is string =>
          typeof topic === "string" && isValidCategorySlug(topic),
      ),
    ),
  );
}

function isValidDailyGoal(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= DAILY_GOAL_MIN &&
    value <= DAILY_GOAL_MAX
  );
}

function parseGoalPathValue(raw: unknown): FieldResult<GoalPath | null> {
  if (raw === null || raw === "") {
    return { ok: true, value: null };
  }

  if (isGoalPath(raw)) {
    return { ok: true, value: raw };
  }

  return { ok: false, error: "Invalid reading goal path" };
}

export function parseProfileInput(body: ProfileInputBody): ProfileInputResult {
  const englishLevel = body.englishLevel;
  if (!isAllowedValue(englishLevel, ENGLISH_LEVELS)) {
    return { ok: false, error: "A valid English level (A1-C2) is required" };
  }

  const ageRangeResult = parseOptionalControlledValue(
    body.ageRange,
    AGE_RANGES,
    "Invalid age range",
  );
  if (!ageRangeResult.ok) {
    return ageRangeResult;
  }

  const genderResult = parseOptionalControlledValue(
    body.gender,
    GENDERS,
    "Invalid gender",
  );
  if (!genderResult.ok) {
    return genderResult;
  }

  const topics = parseTopicSlugs(body.topics);

  let dailyGoal: number | undefined;
  if (body.dailyGoal != null) {
    const raw = body.dailyGoal;
    if (!isValidDailyGoal(raw)) {
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
    const goalPathResult = parseGoalPathValue(body.goalPath);
    if (!goalPathResult.ok) {
      return goalPathResult;
    }
    goalPath = goalPathResult.value;
  }

  return {
    ok: true,
    value: {
      ageRange: ageRangeResult.value,
      gender: genderResult.value,
      englishLevel,
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
