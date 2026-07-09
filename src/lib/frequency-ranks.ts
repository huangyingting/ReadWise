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

const RANK_THRESHOLDS = [
  { max: 1000, band: "top1k" },
  { max: 2000, band: "top2k" },
  { max: 3000, band: "top3k" },
  { max: 5000, band: "top5k" },
] as const satisfies ReadonlyArray<{ max: number; band: WordFrequencyBand }>;

const KNOWN_NON_RARE_BANDS = new Set<WordFrequencyBand>([
  "top1k",
  "top2k",
  "top3k",
  "top5k",
  "top10k",
  "academic",
]);

function bandForRank(rank: number): WordFrequencyBand {
  for (const { max, band } of RANK_THRESHOLDS) {
    if (rank <= max) return band;
  }
  return "top10k";
}

function buildRankBands(): Record<string, WordFrequencyBand> {
  const out = Object.create(null) as Record<string, WordFrequencyBand>;
  WORDFREQ_EN_TOP_10K.forEach((word, index) => {
    out[word] = bandForRank(index + 1);
  });
  return out;
}

const WORD_FREQUENCY_RANKS = buildRankBands();

function coerceBand(value: string | undefined): WordFrequencyBand | null {
  if (!value) return null;
  return KNOWN_NON_RARE_BANDS.has(value as WordFrequencyBand)
    ? (value as WordFrequencyBand)
    : null;
}

/** Returns the best available frequency band for a raw word or `rare`. */
export function wordFrequencyBand(raw: string): WordFrequencyBand {
  for (const candidate of normalizeCandidates(raw)) {
    const ranked = coerceBand(WORD_FREQUENCY_RANKS[candidate]);
    if (ranked) return ranked;
    const band = coerceBand(WORD_FREQUENCY[candidate] as string | undefined);
    if (band) return band;
  }
  return "rare";
}