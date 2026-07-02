/**
 * Shared prompt registry types and constants.
 *
 * Generic building blocks consumed by every feature prompt module and by the
 * registry/index layers. No feature-specific logic lives here.
 */

/** A chat role exchanged with the model. Mirrors the `@/lib/ai` message type. */
export type PromptRole = "system" | "user" | "assistant";

/** A single rendered chat message. */
export type PromptMessage = { role: PromptRole; content: string };

/** Model-call parameters owned by a prompt template (token budget, sampling). */
export type PromptModelParams = {
  /** Upper bound on generated tokens; omitted = provider default. */
  maxOutputTokens?: number;
  /** Desired sampling temperature; omitted = provider default. */
  temperature?: number;
};

/**
 * A versioned prompt template for one AI feature.
 *
 * @typeParam Vars - the render variables this feature needs.
 */
export type PromptTemplate<Vars> = {
  /** Short feature label, matching the `feature` used for logs/ledger. */
  feature: string;
  /** Stable version label recorded in the AI ledger, e.g. "translation/v1". */
  version: string;
  /** Whether this template is the active version for its feature. */
  active: boolean;
  /** Model-call parameters for this prompt. */
  modelParams: PromptModelParams;
  /** Human-readable description for docs / change tracking. */
  description: string;
  /** Pure render of the chat messages from the feature's variables. */
  render: (vars: Vars) => PromptMessage[];
};

// ---------------------------------------------------------------------------
// Shared generation targets (kept here so the prompt text and the helpers that
// slice/validate against the same count can never drift).
// ---------------------------------------------------------------------------

/** How many vocabulary entries the vocabulary prompt requests. */
export const TARGET_VOCABULARY_WORDS = 10;
/** How many comprehension questions the quiz prompt requests. */
export const TARGET_QUIZ_QUESTIONS = 5;
/** How many topic tags the tags prompt requests. */
export const TARGET_TAGS = 5;

// ---------------------------------------------------------------------------
// Per-feature render variable types.
// ---------------------------------------------------------------------------

export type TranslationPromptVars = {
  /** Target language label, e.g. "Spanish". */
  label: string;
  title: string;
  /** The chunk of article text to translate. */
  chunk: string;
  /** Whether this is one section of a longer (chunked) article. */
  isPart: boolean;
};

export type VocabularyPromptVars = { title: string; source: string };
export type QuizPromptVars = { title: string; source: string };
export type TagsPromptVars = { title: string; source: string };

export type GrammarPromptVars = {
  /** The original (un-normalised) phrase as the learner selected it. */
  phrase: string;
  /** Already-trimmed/clamped context sentence ("" when none). */
  context: string;
  /** Already-defaulted CEFR level label, e.g. "B1". */
  level: string;
};

export type TutorPromptVars = {
  /** CEFR level used to calibrate vocabulary/complexity. */
  level: string;
  title: string;
  /** Article plain text (already truncated for token safety). */
  articleText: string;
  /** The learner's question. */
  question: string;
};

export type SentenceTranslationPromptVars = {
  /** Target language label, e.g. "French". */
  label: string;
  /** Already-normalised source text. */
  text: string;
};

/**
 * Maps each feature to the render variables its active template expects. Used to
 * keep {@link renderPrompt} type-safe across features.
 */
export type PromptVarsMap = {
  translation: TranslationPromptVars;
  vocabulary: VocabularyPromptVars;
  quiz: QuizPromptVars;
  tags: TagsPromptVars;
  grammar: GrammarPromptVars;
  tutor: TutorPromptVars;
  "sentence-translation": SentenceTranslationPromptVars;
};

/** A feature key with a registered active prompt template. */
export type PromptFeature = keyof PromptVarsMap;
