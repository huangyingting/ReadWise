/**
 * Diversity-aware ranking — REF-010.
 *
 * Pure; no DB / no I/O. Applies a greedy category-spread pass over an already
 * scored list so the same category is not repeatedly surfaced at the top.
 */

import type { ScoredRecommendation } from "./types";

/** Points removed per prior same-category pick during the diversity pass. */
const DIVERSITY_STEP = 6;
/** Maximum diversity penalty applied to any single article. */
const DIVERSITY_MAX_PENALTY = 18;

/**
 * Greedy diversity-aware ordering. Repeatedly selects the highest-scoring
 * remaining article, applying an increasing penalty to categories already
 * picked so the same category isn't surfaced over and over. The penalty is
 * recorded on each result and folded into its final `score`. Stable: ties keep
 * the incoming (score-desc) order.
 */
export function rankWithDiversity(
  scored: ScoredRecommendation[],
): ScoredRecommendation[] {
  const remaining = [...scored].sort((a, b) => b.baseScore - a.baseScore);
  const result: ScoredRecommendation[] = [];
  const categoryCount = new Map<string, number>();

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestEff = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cat = remaining[i].category ?? "";
      const seen = cat ? categoryCount.get(cat) ?? 0 : 0;
      const penalty = Math.min(DIVERSITY_MAX_PENALTY, seen * DIVERSITY_STEP);
      const eff = remaining[i].baseScore - penalty;
      if (eff > bestEff) {
        bestEff = eff;
        bestIdx = i;
      }
    }
    const [picked] = remaining.splice(bestIdx, 1);
    const cat = picked.category ?? "";
    const seen = cat ? categoryCount.get(cat) ?? 0 : 0;
    const penalty = Math.min(DIVERSITY_MAX_PENALTY, seen * DIVERSITY_STEP);
    picked.diversityPenalty = penalty;
    picked.score = Math.max(0, Math.round((picked.baseScore - penalty) * 10) / 10);
    if (penalty > 0) {
      picked.explanation.push(`diversity: −${penalty} (category already shown)`);
    }
    if (cat) categoryCount.set(cat, seen + 1);
    result.push(picked);
  }
  return result;
}
