/**
 * Adaptive CEFR level progression — #37 + RW-040.
 *
 * Barrel re-export. Implementation split by concern:
 *   recommendation  — quiz-only {@link recommendLevelChange} (pure, #37)
 *   queries         — evidence-based adaptive layer: types, pure
 *                     {@link computeAdaptiveLevel}, DB-backed
 *                     {@link getLevelEvidence} / {@link getAdaptiveLevelRecommendation}
 *                     (RW-040)
 */
export * from "./recommendation";
export * from "./queries";
