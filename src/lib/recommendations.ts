/**
 * Recommendation engine — REF-010.
 *
 * Barrel that re-exports the full public surface of the recommendation
 * subsystem for backward compatibility. Internal implementation is split into
 * focused sub-modules:
 *
 *   - recommendations/types.ts        — shared types and weight constants
 *   - recommendations/explanations.ts — headline and explanation generation
 *   - recommendations/scoring.ts      — pure component scorers + scoreCandidate
 *   - recommendations/diversity.ts    — diversity-aware ranking pass
 *   - recommendations/context.ts      — DB context loading (Prisma)
 *   - recommendations/picks.ts        — cached candidate fetch + picks feed
 */

// Types and weights
export type {
  RecommendationCandidate,
  ScoreComponents,
  ScoredRecommendation,
  RecommendationContext,
} from "./recommendations/types";
export { COMPONENT_WEIGHTS } from "./recommendations/types";

// Pure scoring
export {
  noveltyScore,
  difficultyFeedbackScore,
  wordLoadScore,
  masteryGapScore,
  scoreCandidate,
} from "./recommendations/scoring";

// Diversity ranking
export { rankWithDiversity } from "./recommendations/diversity";

// DB context loading
export { buildRecommendationContext } from "./recommendations/context";

// Cached picks and paginated feed
export type { ScoredPicksPage } from "./recommendations/picks";
export {
  SCORED_PICKS_PAGE_SIZE,
  scoreAndRankArticles,
  listScoredPicksPage,
} from "./recommendations/picks";

// Re-export shared discovery-ranking primitives so existing callers that
// import them from @/lib/recommendations continue to work.
export { levelFitScore, freshnessScore01, topicInterestScore } from "@/lib/discovery-ranking";
