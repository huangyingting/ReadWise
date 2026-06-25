/**
 * Content rights & takedown policy — re-exports from article-library/moderation
 * (REF-040). This file is kept as a compatibility shim so existing importers
 * continue to resolve `@/lib/content-policy` without changes.
 */
export {
  TAKEDOWN_STATES,
  type TakedownState,
  isTakedownState,
  TAKEDOWN_STATE_LABELS,
  takedownForcesDraft,
  type ApplyTakedownInput,
  type ApplyTakedownResult,
  applyTakedown,
} from "@/lib/article-library/moderation";
