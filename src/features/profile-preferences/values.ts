/**
 * Profile value re-exports.
 *
 * All profile option constants are defined in @/lib/option-registries (single
 * source of truth). This file re-exports them so internal feature modules
 * (schema.ts, DailyGoalStepper.tsx) can keep their relative imports without
 * coupling to the library path.
 */
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
} from "@/lib/option-registries";
