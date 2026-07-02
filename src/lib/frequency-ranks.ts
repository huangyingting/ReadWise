/**
 * Granular English word-frequency bands for deterministic article difficulty.
 *
 * This server-only helper is intentionally separate from `frequency.ts`, whose
 * public API still powers learner-facing dictionary badges (`top1k`, `top5k`,
 * `academic`). Difficulty scoring needs richer deterministic bands derived from
 * a checked-in `wordfreq` top-10k rank source.
 */

import { WORD_FREQUENCY } from "@/data/word-frequency-data";
import { WORDFREQ_EN_TOP_10K } from "@/data/wordfreq-en-ranks";
import { normalizeCandidates } from "@/lib/lexical/normalize";

export type WordFrequencyBand =
  | "top1k"
  | "top2k"
  | "top3k"
  | "top5k"
  | "top10k"
  | "academic"
  | "rare";

function bandForRank(rank: number): WordFrequencyBand {
  if (rank <= 1000) return "top1k";
  if (rank <= 2000) return "top2k";
  if (rank <= 3000) return "top3k";
  if (rank <= 5000) return "top5k";
  return "top10k";
}

function buildRankBands(): Record<string, WordFrequencyBand> {
  const out: Record<string, WordFrequencyBand> = {};
  WORDFREQ_EN_TOP_10K.forEach((word, index) => {
    out[word] = bandForRank(index + 1);
  });
  return out;
}

const WORD_FREQUENCY_RANKS = buildRankBands();

function coerceBand(value: string | undefined): WordFrequencyBand | null {
  switch (value) {
    case "top1k":
    case "top2k":
    case "top3k":
    case "top5k":
    case "top10k":
    case "academic":
      return value;
    default:
      return null;
  }
}

/** Returns the best available frequency band for a raw word or `rare`. */
export function wordFrequencyBand(raw: string): WordFrequencyBand {
  for (const candidate of normalizeCandidates(raw)) {
    const ranked = WORD_FREQUENCY_RANKS[candidate];
    if (ranked) return ranked;
    const band = coerceBand(WORD_FREQUENCY[candidate]);
    if (band) return band;
  }
  return "rare";
}