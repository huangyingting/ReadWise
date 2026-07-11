/** Current deterministic article-difficulty algorithm identifier. */
export const DIFFICULTY_ALGORITHM_VERSION = "deterministic-cefr/hybrid-calibrated-v5";

/**
 * Calibration caveat for v4/v5: raw calibration text is not committed here. The
 * hybrid threshold pass used opt-in UniversalCEFR/elg_cefr_en evidence
 * (CC BY-NC-SA 4.0) as full A1-C2 input plus OneStopEnglish (CC BY-SA 4.0)
 * elementary/intermediate/advanced article-level ordinal anchors. ReadWise CEFR
 * remains heuristic/calibrated, and lexileApprox remains Lexile-like rather
 * than an official Lexile measure.
 *
 * v5 correction: normalize U+2019 typographic apostrophe through the existing
 * apostrophe normalization regex so curly-apostrophe contractions receive the
 * same lexical lookup as straight-apostrophe equivalents.
 */
export const DIFFICULTY_CALIBRATION_CAVEAT = {
  source: "UniversalCEFR/elg_cefr_en + OneStopEnglish",
  license: "CC BY-NC-SA 4.0; CC BY-SA 4.0",
  rawTextCommitted: false,
  labelUse: "opt-in NC A1-C2 labels plus article-level ordinal anchors; not official CEFR certification",
  cefr: "heuristic/hybrid-calibrated",
  lexile: "Lexile-like",
  ncGate: "--enable-nc required for NC calibration inputs",
} as const;
