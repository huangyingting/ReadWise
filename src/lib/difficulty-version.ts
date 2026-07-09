/** Current deterministic article-difficulty algorithm identifier. */
export const DIFFICULTY_ALGORITHM_VERSION = "deterministic-cefr/onestop-calibrated-v3";

/**
 * Calibration caveat for v3: OneStopEnglish raw text is not committed here; the
 * corpus is CC BY-SA 4.0. Its elementary/intermediate/advanced labels are
 * ordinal reading-level anchors, not exact six-band A1-C2 CEFR gold labels.
 * ReadWise CEFR remains heuristic/calibrated, and lexileApprox remains
 * Lexile-like rather than an official Lexile measure.
 */
export const DIFFICULTY_CALIBRATION_CAVEAT = {
  source: "OneStopEnglish",
  license: "CC BY-SA 4.0",
  rawTextCommitted: false,
  labelUse: "ordinal anchors, not exact A1-C2 gold labels",
  cefr: "heuristic/calibrated",
  lexile: "Lexile-like",
} as const;
