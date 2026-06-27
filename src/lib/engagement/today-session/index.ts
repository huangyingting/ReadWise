/**
 * Today Session subsystem — public barrel (#789/#790/#791).
 *
 * Stable entry-point for the Today Session domain service. The generator and
 * repository are server-only (they import Prisma); the types module is pure.
 *
 * NOTE: Node `--experimental-strip-types` cannot mix value and type names in a
 * single `export { ... }` statement, so values and types are exported with
 * separate `export` / `export type` statements below.
 */

// ── Controlled values + validators (pure) ─────────────────────────────────
export {
  TODAY_SESSION_STATUSES,
  TODAY_SESSION_SOURCES,
  TODAY_COMPLETION_TIERS,
  TODAY_GENERATION_REASON_CODES,
  TODAY_SKIP_REASONS,
  TARGET_WORD_COUNT_MIN,
  TARGET_WORD_COUNT_MAX,
  isTodaySessionStatus,
  isTodaySessionSource,
  isTodayCompletionTier,
  isTodayGenerationReasonCode,
  isTodaySkipReason,
  assertControlledValue,
  toIdArray,
} from "./types";
export type {
  TodaySessionStatus,
  TodaySessionSource,
  TodayCompletionTier,
  TodayGenerationReasonCode,
  TodaySkipReason,
  TodaySessionView,
  TodaySessionPlan,
} from "./types";

// ── Local-date resolution ──────────────────────────────────────────────────
export { resolveLocalDate, resolveTimezone, isValidTimezone } from "./local-date";
export type { LocalDateResolution } from "./local-date";

// ── Repository (server-only) ────────────────────────────────────────────────
export {
  getTodaySession,
  createTodaySession,
  updateTodaySession,
  toTodaySessionView,
} from "./repository";
export type { TodaySessionUpdate } from "./repository";

// ── Generator (server-only) ─────────────────────────────────────────────────
export {
  getOrCreateTodaySession,
  buildTodayPlan,
  RESUME_MIN_PERCENT,
  RESUME_MAX_PERCENT,
  RESUME_RECENT_DAYS,
  BACKUP_ARTICLE_COUNT,
} from "./generator";

// ── Target-word selection (server-only) ─────────────────────────────────────
export { selectTargetWordIds } from "./target-words";
export type { TargetWordSelection } from "./target-words";
