/**
 * Recommendations subsystem — public barrel.
 *
 * Exposes the stable surface of the recommendations engine. Internal modules
 * (`diversity.ts`, `explanations.ts`) remain private to the subsystem.
 *
 * Sub-module layout:
 *   types.ts        — domain types and weights (RecommendationCandidate, ScoredRecommendation, …)
 *   context.ts      — per-user signal loading (buildRecommendationContext)
 *   scoring.ts      — pure component scorers (scoreCandidate, noveltyScore, …)
 *   picks.ts        — candidate fetch + paginated scored feed (listScoredPicksPage)
 *   diversity.ts    — private: category-diversity penalty
 *   explanations.ts — private: human-readable score explanations
 */

// ── Types ────────────────────────────────────────────────────────────────────
export type {
  RecommendationCandidate,
  ScoreComponents,
  ScoredRecommendation,
  RecommendationContext,
} from "./types";
export { COMPONENT_WEIGHTS } from "./types";

// ── Context loading ──────────────────────────────────────────────────────────
export { buildRecommendationContext } from "./context";

// ── Scoring ──────────────────────────────────────────────────────────────────
export {
  noveltyScore,
  difficultyFeedbackScore,
  wordLoadScore,
  masteryGapScore,
  scoreCandidate,
} from "./scoring";

// ── Picks feed ───────────────────────────────────────────────────────────────
export type { ScoredPicksPage } from "./picks";
export {
  SCORED_PICKS_PAGE_SIZE,
  scoreAndRankArticles,
  listScoredPicksPage,
} from "./picks";
