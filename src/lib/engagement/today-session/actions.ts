/**
 * Today Session learner actions.
 *
 * This is the stable server-side interface for controlled learner intents.
 * Repository writes, completion policy, analytics, and local-day resolution
 * remain implementation details of the owning modules.
 */

export { enforceTodayGate } from "./feature-gate";
export { skipTodaySession, TODAY_DAILY_SKIP_LIMIT } from "./skip";
export type { SkipResult } from "./skip";
export {
  setTodayPrimaryArticle,
  SetTodayArticleError,
} from "./set-article";
export type { SetTodayArticleErrorCode } from "./set-article";
export {
  markTodayReadingCompleteManual,
  markTodayWordReviewComplete,
} from "./completion";
export {
  COMPREHENSION_SELF_RATINGS,
  COMPREHENSION_SKILL_TAGS,
  submitTodayComprehension,
} from "./comprehension";
export type {
  ComprehensionSelfRating,
  ComprehensionSkillTag,
  SubmitTodayComprehensionArgs,
  TodayComprehensionResult,
} from "./comprehension";
export { TODAY_SKIP_REASONS } from "./types";
export type { TodaySkipReason } from "./types";