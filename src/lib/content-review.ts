/**
 * Content quality review & moderation — re-exports from
 * article-library/moderation (REF-040). This file is kept as a compatibility
 * shim so existing importers continue to resolve `@/lib/content-review` without
 * changes.
 */
export {
  REVIEW_STATES,
  type ReviewState,
  isReviewState,
  REVIEW_STATE_LABELS,
  QUALITY_FLAGS,
  normalizeQualityFlags,
  parseQualityFlags,
  type ReviewCorrections,
  type ReviewArticleInput,
  type ReviewArticleResult,
  type ContentReviewRow,
  reviewArticle,
  listContentReviews,
} from "@/lib/article-library/moderation";
