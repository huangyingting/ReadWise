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
 *   1. Add a FeatureDefinition entry to FEATURE_REGISTRY here, including the
 *      optional `isMissingFrom`, `clearFrom`, `isDoneIn`, and `stepResultName`
 *      callbacks so no other file needs editing.
 *   2. Add its step runner to STEP_RUNNERS in processing/processor.ts.
 *   3. Add tests.
 */
import type { Prisma } from "@prisma/client";
import { DIFFICULTY_ALGORITHM_VERSION } from "@/lib/difficulty-version";

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

/**
 * Minimal article state shape consumed by `isMissingFrom` callbacks.
 * Structural supertype of `CandidateArticle` in processing/backfill.ts.
 */
export type FeatureCandidateState = {
  difficulty: string | null;
  lexileApprox: number | null;
  difficultyVersion: string | null;
  speech: { articleId: string } | null;
  translations: { targetLang: string }[];
  _count: {
    tags: number;
    vocabulary: number;
    quizQuestions: number;
    grammarExplanations: number;
  };
};

/**
 * Minimal article state shape consumed by `isDoneIn` callbacks.
 * Structural supertype of `ArticleState` in processing/processor.ts.
 */
export type FeatureProcessingState = {
  hasDifficulty: boolean;
  tagCount: number;
  vocabCount: number;
  quizCount: number;
  hasSpeech: boolean;
};

/**
 * The step name written to StepResult.step. Defined here so registry callbacks
 * can reference it without importing from processor.ts.
 */
export type RegistryStepName =
  | "difficulty"
  | "tags"
  | "vocabulary"
  | "quiz"
  | "translation"
  | "tts"
  | "speech"
  | "grammar"
  | "publish";

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

  // ---- Optional extensibility callbacks (BE-11/BE-12) -------------------------
  /**
   * Returns true when this feature has not yet been computed for `article`.
   * Used by backfill planning to build the "missing" work list.
   * When absent, the feature is treated as never missing (e.g. translation,
   * which is handled per-lang in the caller).
   */
  readonly isMissingFrom?: (article: FeatureCandidateState) => boolean;
  /**
   * Clears this feature's derived caches inside the running transaction.
   * Called by rebuild mode so the worker regenerates fresh content.
   * When absent, no data is cleared for this feature.
   */
  readonly clearFrom?: (tx: Prisma.TransactionClient, articleId: string) => Promise<void>;
  /**
   * Returns true when this feature has already been computed for `state`.
   * Used by the processor to skip already-done steps idempotently.
   * When absent, the feature is treated as never done (always re-runs).
   */
  readonly isDoneIn?: (state: FeatureProcessingState) => boolean;
  /**
   * Override for the StepResult.step name emitted by the processor.
   * Defaults to `feature.key`. Set to `"tts"` for the speech feature so that
   * external consumers (scripts, admin UI) see the conventional name.
   */
  readonly stepResultName?: RegistryStepName;
};

export const FEATURE_REGISTRY: readonly FeatureDefinition[] = [
  {
    key: "difficulty",
    label: "Difficulty",
    supportsLangs: false,
    isTts: false,
    isRequired: true,
    isMissingFrom: (a) =>
      a.difficulty == null ||
      a.lexileApprox == null ||
      a.difficultyVersion !== DIFFICULTY_ALGORITHM_VERSION,
    clearFrom: async (tx, articleId) => {
      await tx.article.update({
        where: { id: articleId },
        data: {
          difficulty: null,
          difficultyScore: null,
          lexileApprox: null,
          difficultyVersion: null,
        },
      });
    },
    isDoneIn: (s) => s.hasDifficulty,
  },
  {
    key: "tags",
    label: "Tags",
    supportsLangs: false,
    isTts: false,
    isRequired: true,
    isMissingFrom: (a) => a._count.tags === 0,
    clearFrom: async (tx, articleId) => {
      await tx.articleTag.deleteMany({ where: { articleId } });
    },
    isDoneIn: (s) => s.tagCount > 0,
  },
  {
    key: "vocabulary",
    label: "Vocabulary",
    supportsLangs: false,
    isTts: false,
    isRequired: true,
    isMissingFrom: (a) => a._count.vocabulary === 0,
    clearFrom: async (tx, articleId) => {
      await tx.vocabularyItem.deleteMany({ where: { articleId } });
    },
    isDoneIn: (s) => s.vocabCount > 0,
  },
  {
    key: "quiz",
    label: "Quiz",
    supportsLangs: false,
    isTts: false,
    isRequired: true,
    isMissingFrom: (a) => a._count.quizQuestions === 0,
    clearFrom: async (tx, articleId) => {
      await tx.quizQuestion.deleteMany({ where: { articleId } });
    },
    isDoneIn: (s) => s.quizCount > 0,
  },
  {
    key: "translation",
    label: "Translation",
    supportsLangs: true,
    isTts: false,
    isRequired: false,
    // translation is handled per-lang in the caller; no scalar isMissingFrom/isDoneIn
    clearFrom: async (tx, articleId) => {
      // Translation step keys arrive as "translation:<lang>"; the registry entry
      // only defines the base clear when the caller passes the full key.
      // Per-lang clearing is handled directly in defaultClearFeatures.
      void articleId; void tx;
    },
  },
  {
    key: "speech",
    label: "Text-to-Speech",
    supportsLangs: false,
    isTts: true,
    isRequired: false,
    isMissingFrom: (a) => !a.speech,
    clearFrom: async (tx, articleId) => {
      await tx.articleSpeech.deleteMany({ where: { articleId } });
    },
    isDoneIn: (s) => s.hasSpeech,
    stepResultName: "tts",
  },
  {
    key: "grammar",
    label: "Grammar",
    supportsLangs: false,
    isTts: false,
    isRequired: false,
    isMissingFrom: (a) => a._count.grammarExplanations === 0,
    clearFrom: async (tx, articleId) => {
      await tx.grammarExplanation.deleteMany({ where: { articleId } });
    },
    // grammar is on-demand only; processor always skips it (no isDoneIn)
  },
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
