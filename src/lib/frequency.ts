/**
 * Word frequency tier lookup (US-123).
 *
 * Returns a tier label for a word based on a compact static frequency list
 * derived from public-domain corpus data (COCA / BNC / wordfreq).
 *
 * Tiers (ordered highest→lowest frequency):
 *   "top1k"    — top 1,000 most frequent English words (essential vocabulary)
 *   "top5k"    — top 5,000 most frequent English words (everyday vocabulary)
 *   "academic" — Oxford Academic Word List words not already in top 5k
 *   null       — not in the frequency data (specialized / rare)
 *
 * Safe to import in both server and client components.
 */

import { normalizeCandidates } from "@/lib/dictionary-normalize";
import { WORD_FREQUENCY } from "@/data/word-frequency-data";
import {
  type FrequencyTier,
  TIER_LABELS,
  TIER_VARIANTS,
} from "@/lib/option-registries";

export type { FrequencyTier };
export { TIER_LABELS, TIER_VARIANTS };

/**
 * Returns the frequency tier for a word (or null when not in the list).
 *
 * Normalizes the raw input via `normalizeCandidates` so inflected forms
 * (e.g. "running" → "run", "studies" → "study") resolve to their base form.
 * Matching is case-insensitive.
 */
export function frequencyTier(raw: string): FrequencyTier | null {
  if (!raw || !raw.trim()) return null;
  const candidates = normalizeCandidates(raw);
  // normalizeCandidates already returns lower-case forms
  for (const c of candidates) {
    const tier = WORD_FREQUENCY[c] as FrequencyTier | undefined;
    if (tier) return tier;
  }
  return null;
}
