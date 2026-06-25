/**
 * Canonical article-processing feature registry (REF-025).
 *
 * Single source of truth for feature keys, step keys, display labels, and
 * feature metadata. Replaces the previously duplicated `PROCESSING_STEPS`
 * (processing-state.ts) and `BACKFILL_FEATURES` (backfill.ts) with one list so
 * processor, backfill, state-tracking, and admin ops all share the same
 * vocabulary.
 *
 * Adding a new enrichment feature:
 *   1. Add a FeatureDefinition entry to FEATURE_REGISTRY here.
 *   2. Add its step runner to STEP_RUNNERS in processing/processor.ts.
 *   3. Add its missing check to candidateMissing() in processing/backfill.ts.
 *   4. Add its cache-clear case to defaultClearFeatures() in processing/backfill.ts.
 *   5. Add tests.
 */

/** All feature keys supported by the processing pipeline, in processing order. */
export const FEATURE_KEYS = [
  "difficulty",
  "tags",
  "vocabulary",
  "quiz",
  "translation",
  "speech",
  "grammar",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureDefinition = {
  /** Canonical feature identifier and base DB step key. */
  readonly key: FeatureKey;
  /** Human-readable label for admin dashboards and logs. */
  readonly label: string;
  /**
   * Translation generates one ArticleProcessingStep per target language
   * ("translation:es", "translation:fr", …). All other features are single-step.
   */
  readonly supportsLangs: boolean;
  /**
   * Speech/TTS feature: only processed when ProcessOptions.tts is true.
   * Stored in ArticleProcessingStep as "speech"; StepResult.step is "tts".
   */
  readonly isTts: boolean;
  /**
   * Required for a draft article to be considered fully enriched.
   * Articles missing required features are not published.
   */
  readonly isRequired: boolean;
};

export const FEATURE_REGISTRY: readonly FeatureDefinition[] = [
  { key: "difficulty",  label: "Difficulty",      supportsLangs: false, isTts: false, isRequired: true  },
  { key: "tags",        label: "Tags",             supportsLangs: false, isTts: false, isRequired: true  },
  { key: "vocabulary",  label: "Vocabulary",       supportsLangs: false, isTts: false, isRequired: true  },
  { key: "quiz",        label: "Quiz",             supportsLangs: false, isTts: false, isRequired: true  },
  { key: "translation", label: "Translation",      supportsLangs: true,  isTts: false, isRequired: false },
  { key: "speech",      label: "Text-to-Speech",   supportsLangs: false, isTts: true,  isRequired: false },
  { key: "grammar",     label: "Grammar",          supportsLangs: false, isTts: false, isRequired: false },
];

/** Type guard for feature keys. */
export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

/**
 * Returns the ArticleProcessingStep key(s) for a feature. Translation expands
 * to one key per language; all other features return [featureKey].
 */
export function stepKeysFor(feature: FeatureKey, langs: string[] = []): string[] {
  if (feature === "translation") {
    return langs.map((lang) => `translation:${lang}`);
  }
  return [feature];
}
