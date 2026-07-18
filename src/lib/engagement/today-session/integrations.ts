/**
 * Today Session completion hooks for facts owned by other domains.
 *
 * Reader and Study callers report completed work through this interface;
 * Today owns local-day lookup, primary-article checks, and tier transitions.
 */

export {
  markTodayComprehensionComplete,
  markTodayReadingComplete,
  markTodayWordReviewComplete,
  syncTodayReadingFromProgress,
} from "./completion";