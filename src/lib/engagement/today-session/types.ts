/**
 * Today Session — controlled values, validators, and public types (#789).
 *
 * Pure module: no Prisma or runtime-config imports, so it is safe to share
 * between server and (read-only) client code. The constants here are the single
 * source of truth for the controlled string columns on the `TodaySession`
 * model. Following the `ArticleDifficultyFeedback.vote` convention, these are
 * plain strings (not Prisma enums) kept valid by the validators below, which
 * REJECT unknown values BEFORE any write reaches the database.
 *
 * Privacy: every type here describes anchors/ids/statuses only — never article
 * text, word text, definitions, examples, context sentences, or notes.
 */

// ---------------------------------------------------------------------------
// Controlled value sets
// ---------------------------------------------------------------------------

/** Lifecycle state of a Today session. */
export const TODAY_SESSION_STATUSES = ["active", "completed", "skipped"] as const;
export type TodaySessionStatus = (typeof TODAY_SESSION_STATUSES)[number];

/** How the primary article was chosen. */
export const TODAY_SESSION_SOURCES = ["resume", "picks", "none"] as const;
export type TodaySessionSource = (typeof TODAY_SESSION_SOURCES)[number];

/** How much of the daily plan the learner completed. */
export const TODAY_COMPLETION_TIERS = [
  "none",
  "reading",
  "comprehension",
  "full",
] as const;
export type TodayCompletionTier = (typeof TODAY_COMPLETION_TIERS)[number];

/**
 * Machine-readable code explaining how the plan was generated. Diagnostic only;
 * it carries no learning content.
 */
export const TODAY_GENERATION_REASON_CODES = [
  "resume_in_progress",
  "picks_primary",
  "no_candidate",
] as const;
export type TodayGenerationReasonCode =
  (typeof TODAY_GENERATION_REASON_CODES)[number];

/** Controlled reasons a learner may skip a day. */
export const TODAY_SKIP_REASONS = [
  "not_interested",
  "too_busy",
  "too_hard",
  "too_easy",
  "other",
] as const;
export type TodaySkipReason = (typeof TODAY_SKIP_REASONS)[number];

/** Default target saved-word count when enough candidates exist. */
export const TARGET_WORD_COUNT_MIN = 3;
export const TARGET_WORD_COUNT_MAX = 5;

// ---------------------------------------------------------------------------
// Validators (reject invalid values before persistence)
// ---------------------------------------------------------------------------

function isMember<T extends readonly string[]>(
  set: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && (set as readonly string[]).includes(value);
}

export function isTodaySessionStatus(v: unknown): v is TodaySessionStatus {
  return isMember(TODAY_SESSION_STATUSES, v);
}

export function isTodaySessionSource(v: unknown): v is TodaySessionSource {
  return isMember(TODAY_SESSION_SOURCES, v);
}

export function isTodayCompletionTier(v: unknown): v is TodayCompletionTier {
  return isMember(TODAY_COMPLETION_TIERS, v);
}

export function isTodayGenerationReasonCode(
  v: unknown,
): v is TodayGenerationReasonCode {
  return isMember(TODAY_GENERATION_REASON_CODES, v);
}

export function isTodaySkipReason(v: unknown): v is TodaySkipReason {
  return isMember(TODAY_SKIP_REASONS, v);
}

/**
 * Asserts a controlled value belongs to its set, throwing a stable error when
 * it does not. Used by the repository to fail closed before any write.
 */
export function assertControlledValue<T extends readonly string[]>(
  set: T,
  value: unknown,
  field: string,
): T[number] {
  if (!isMember(set, value)) {
    throw new Error(
      `Invalid TodaySession ${field}: ${JSON.stringify(value)} (allowed: ${set.join(", ")})`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Public domain types
// ---------------------------------------------------------------------------

/**
 * Privacy-safe view of a Today session. Mirrors the persisted row but narrows
 * the controlled columns to their union types and the JSON columns to id
 * arrays. Contains anchors/ids only — never learning content.
 */
export type TodaySessionView = {
  id: string;
  userId: string;
  localDate: string;
  timezoneSnapshot: string;
  primaryArticleId: string | null;
  backupArticleIds: string[];
  targetSavedWordIds: string[];
  reviewTargetCount: number;
  status: TodaySessionStatus;
  source: TodaySessionSource;
  completionTier: TodayCompletionTier;
  generationReasonCode: TodayGenerationReasonCode;
  readingCompletedAt: Date | null;
  comprehensionCompletedAt: Date | null;
  wordReviewCompletedAt: Date | null;
  completedAt: Date | null;
  skipped: boolean;
  skipReason: TodaySkipReason | null;
  skippedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Inputs for a generated daily plan, prior to persistence. */
export type TodaySessionPlan = {
  primaryArticleId: string | null;
  backupArticleIds: string[];
  targetSavedWordIds: string[];
  reviewTargetCount: number;
  source: TodaySessionSource;
  generationReasonCode: TodayGenerationReasonCode;
};

/**
 * Coerce an unknown JSON value (Prisma `Json` column) into a string-id array,
 * dropping any non-string entries. Defensive: the column should only ever hold
 * string ids, but persisted JSON is untyped.
 */
export function toIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}
