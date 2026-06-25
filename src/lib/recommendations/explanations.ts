/**
 * Explanation and headline generation for recommendation scoring — REF-010.
 *
 * Pure; no DB / no I/O. Renders the human-readable `reason` headline and the
 * per-component `explanation` lines that every ScoredRecommendation carries.
 */

import type {
  RecommendationCandidate,
  ScoreComponents,
  RecommendationContext,
} from "./types";
import { COMPONENT_WEIGHTS } from "./types";

// ---------------------------------------------------------------------------
// Labels (exported for tests / debugging)
// ---------------------------------------------------------------------------

export const COMPONENT_LABELS: Record<keyof ScoreComponents, string> = {
  levelFit: "level fit",
  topicInterest: "topic interest",
  novelty: "novelty",
  difficultyFeedback: "difficulty feedback",
  masteryGap: "learning opportunity",
  wordLoad: "vocabulary load",
  freshness: "freshness",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function titleCase(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

// ---------------------------------------------------------------------------
// Public generators
// ---------------------------------------------------------------------------

/**
 * Returns the short headline reason driven by the dominant weighted component.
 */
export function headlineReason(
  candidate: RecommendationCandidate,
  components: ScoreComponents,
  ctx: RecommendationContext,
): string {
  let topKey: keyof ScoreComponents = "freshness";
  let topVal = -Infinity;
  for (const key of Object.keys(components) as Array<keyof ScoreComponents>) {
    const weighted = components[key] * COMPONENT_WEIGHTS[key];
    if (weighted > topVal) {
      topVal = weighted;
      topKey = key;
    }
  }

  switch (topKey) {
    case "topicInterest":
      return candidate.category
        ? `Matches your interest in ${titleCase(candidate.category)}`
        : "Matches your interests";
    case "levelFit":
      return ctx.userLevel
        ? `Right for your ${ctx.userLevel} level`
        : "A good reading-level match";
    case "novelty":
      return "New to you";
    case "masteryGap":
      return ctx.weakestSkill
        ? `Helps build your ${ctx.weakestSkill}`
        : "A fresh learning opportunity";
    case "wordLoad":
      return "A comfortable vocabulary stretch";
    case "difficultyFeedback":
      return ctx.difficultyBias < 0
        ? "Easier, matching your recent feedback"
        : "A bit more challenging, as you asked";
    default:
      return "Freshly published";
  }
}

/**
 * Builds one human-readable explanation line per component (weight + score).
 */
export function buildExplanationLines(components: ScoreComponents): string[] {
  return (Object.keys(components) as Array<keyof ScoreComponents>).map(
    (key) =>
      `${COMPONENT_LABELS[key]}: ${Math.round(components[key] * 100)}% (weight ${COMPONENT_WEIGHTS[key]})`,
  );
}
