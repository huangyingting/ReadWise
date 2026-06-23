/**
 * Versioned prompt template registry (RW-020).
 *
 * Prompt text used to live inline inside each AI feature helper, which made it
 * impossible to know which prompt revision produced a piece of cached content or
 * whether a quality regression came from a prompt change. This module is the
 * single, code-based source of truth for every feature's prompt: per feature it
 * defines a {@link PromptTemplate} carrying its `feature`, a stable `version`
 * label, the `modelParams` (token budget etc.), an `active` flag, and a pure
 * `render(vars)` function that produces the chat messages.
 *
 * Storage decision: prompts live in CODE (versioned files), not the database.
 * For early simplicity this keeps prompts reviewable in PRs, diffable over time,
 * and free of an admin-editing/permission/audit surface. Database-editable
 * prompts can be layered on later if needed (they would require admin
 * permissions + audit logs per the RW-020 notes).
 *
 * Behaviour preservation: the templates below reproduce the EXACT wording the
 * feature helpers previously embedded, and keep the existing `<feature>/v1`
 * version labels, so cached content and existing tests stay valid. Bumping a
 * template's `version` is the documented trigger for a targeted rebuild/backfill
 * (see {@link featuresWithStalePrompts} and docs/ai-prompts.md).
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
export type DifficultyPromptVars = { title: string; source: string };

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

// ---------------------------------------------------------------------------
// Templates. The wording below is intentionally identical to the previously
// inline prompts — do NOT edit text without bumping the `version`.
// ---------------------------------------------------------------------------

const translationTemplate: PromptTemplate<TranslationPromptVars> = {
  feature: "translation",
  version: "translation/v1",
  active: true,
  modelParams: {},
  description: "Faithful, paragraph-preserving article translation (chunk-aware).",
  render: ({ label, title, chunk, isPart }) => {
    const partNote = isPart
      ? " You are translating one section of a longer article; translate it " +
        "faithfully on its own without adding intro/outro text."
      : "";
    return [
      {
        role: "system",
        content:
          `You are a professional translator. Translate the user's article into ${label}. ` +
          "Preserve paragraph breaks. Output only the translated text with no commentary, " +
          "no notes, and no markdown fences." +
          partNote,
      },
      {
        role: "user",
        content: `Title: ${title}\n\n${chunk}`,
      },
    ];
  },
};

const vocabularyTemplate: PromptTemplate<VocabularyPromptVars> = {
  feature: "vocabulary",
  version: "vocabulary/v1",
  active: true,
  modelParams: {},
  description: "Extract the most useful/challenging learner vocabulary as JSON.",
  render: ({ title, source }) => [
    {
      role: "system",
      content:
        "You are an English vocabulary tutor. From the user's article, select the " +
        `${TARGET_VOCABULARY_WORDS} most useful, challenging vocabulary words or phrases for an ` +
        "English learner. Respond ONLY with a JSON array. Each element must be an " +
        'object with exactly these string keys: "word" (the term), "explanation" (a ' +
        'concise learner-friendly definition), and "example" (one short sample ' +
        "sentence using the word). No markdown, no commentary, JSON array only.",
    },
    {
      role: "user",
      content: `Title: ${title}\n\n${source}`,
    },
  ],
};

const quizTemplate: PromptTemplate<QuizPromptVars> = {
  feature: "quiz",
  version: "quiz/v1",
  active: true,
  modelParams: {},
  description: "Generate multiple-choice comprehension questions as JSON.",
  render: ({ title, source }) => [
    {
      role: "system",
      content:
        "You are an English reading-comprehension tutor. From the user's " +
        `article, write ${TARGET_QUIZ_QUESTIONS} multiple-choice comprehension ` +
        "questions that check whether a reader understood the text. Respond " +
        "ONLY with a JSON array. Each element must be an object with exactly " +
        'these keys: "question" (the question text), "options" (an array of ' +
        "3 or 4 distinct answer strings), and \"correctIndex\" (the 0-based " +
        "index of the single correct option). Exactly one option is correct. " +
        "No markdown, no commentary, JSON array only.",
    },
    {
      role: "user",
      content: `Title: ${title}\n\n${source}`,
    },
  ],
};

const tagsTemplate: PromptTemplate<TagsPromptVars> = {
  feature: "tags",
  version: "tags/v1",
  active: true,
  modelParams: {},
  description: "Choose concise Title-Case topic tags as a JSON array of strings.",
  render: ({ title, source }) => [
    {
      role: "system",
      content:
        "You label news articles with topic tags for discovery. From the user's " +
        `article, choose up to ${TARGET_TAGS} concise topic tags (1-3 words each, ` +
        "Title Case, e.g. \"Climate Change\", \"Artificial Intelligence\"). Respond " +
        "ONLY with a JSON array of tag strings. No markdown, no commentary, JSON " +
        "array only.",
    },
    {
      role: "user",
      content: `Title: ${title}\n\n${source}`,
    },
  ],
};

const difficultyTemplate: PromptTemplate<DifficultyPromptVars> = {
  feature: "difficulty",
  version: "difficulty/v1",
  active: true,
  modelParams: { maxOutputTokens: 16 },
  description: "Assess CEFR reading difficulty; reply with one A1–C2 token.",
  render: ({ title, source }) => [
    {
      role: "system",
      content:
        "You assess the reading difficulty of English texts for language " +
        "learners using the CEFR scale. Reply with exactly one level from " +
        "A1, A2, B1, B2, C1, C2 — the level a learner needs to comfortably " +
        "read the text. Respond with the two-character level only, no other " +
        "words.",
    },
    {
      role: "user",
      content: `Title: ${title}\n\n${source}`,
    },
  ],
};

const grammarTemplate: PromptTemplate<GrammarPromptVars> = {
  feature: "grammar",
  version: "grammar/v1",
  active: true,
  modelParams: { maxOutputTokens: 256 },
  description: "Explain a selected phrase/grammar pattern in plain English.",
  render: ({ phrase, context, level }) => [
    {
      role: "system",
      content: `You are a friendly English tutor. Explain phrases and grammar in plain English suitable for a ${level} learner. Be concise (2–3 sentences). Do not use HTML.`,
    },
    {
      role: "user",
      content: context
        ? `Explain the phrase "${phrase}" as used in this sentence: "${context}". Is it a phrasal verb, idiom, collocation, or grammar pattern? Give one short example.`
        : `Explain the phrase "${phrase}". Is it a phrasal verb, idiom, collocation, or grammar pattern? Give one short example.`,
    },
  ],
};

const tutorTemplate: PromptTemplate<TutorPromptVars> = {
  feature: "tutor",
  version: "tutor/v1",
  active: true,
  modelParams: { maxOutputTokens: 2048 },
  description: "Article-grounded conversational tutor, calibrated to CEFR level.",
  render: ({ level, title, articleText, question }) => [
    {
      role: "system",
      content:
        `You are a friendly English-learning tutor. The user is reading the article below.\n` +
        `Answer ONLY questions about this article, grounded strictly in its text. Be concise and clear.\n` +
        `Adjust your vocabulary and sentence complexity to approximately CEFR level ${level}.\n` +
        `If the answer is not in the article, say so briefly (1–2 sentences) and do not speculate.\n\n` +
        `ARTICLE TITLE: "${title}"\n` +
        `---\n` +
        articleText,
    },
    {
      role: "user",
      content: question,
    },
  ],
};

const sentenceTranslationTemplate: PromptTemplate<SentenceTranslationPromptVars> = {
  feature: "sentence-translation",
  version: "sentence-translation/v1",
  active: true,
  modelParams: { maxOutputTokens: 256 },
  description: "Translate a single selected sentence/phrase, learner-friendly.",
  render: ({ label, text }) => [
    {
      role: "system",
      content:
        `Translate the following sentence or phrase from an English article into ${label}. ` +
        "Return ONLY the translation, natural and learner-friendly.",
    },
    { role: "user", content: text },
  ],
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
  difficulty: DifficultyPromptVars;
  grammar: GrammarPromptVars;
  tutor: TutorPromptVars;
  "sentence-translation": SentenceTranslationPromptVars;
};

/** A feature key with a registered active prompt template. */
export type PromptFeature = keyof PromptVarsMap;

/**
 * The active prompt template per feature. This is the registry — every AI
 * feature renders its messages from here instead of inline strings.
 */
export const PROMPT_TEMPLATES: {
  [F in PromptFeature]: PromptTemplate<PromptVarsMap[F]>;
} = {
  translation: translationTemplate,
  vocabulary: vocabularyTemplate,
  quiz: quizTemplate,
  tags: tagsTemplate,
  difficulty: difficultyTemplate,
  grammar: grammarTemplate,
  tutor: tutorTemplate,
  "sentence-translation": sentenceTranslationTemplate,
};

/** The list of features with a registered prompt template. */
export const PROMPT_FEATURES = Object.keys(PROMPT_TEMPLATES) as PromptFeature[];

/** Type guard: whether a feature string has a registered prompt template. */
export function isPromptFeature(feature: string): feature is PromptFeature {
  return Object.prototype.hasOwnProperty.call(PROMPT_TEMPLATES, feature);
}

/**
 * Returns the active prompt version label for a feature. Features without a
 * registered template fall back to `<feature>/v1` so callers (and cache keys)
 * keep a stable, monotonic default.
 */
export function activePromptVersion(feature: string): string {
  return isPromptFeature(feature) ? PROMPT_TEMPLATES[feature].version : `${feature}/v1`;
}

/** Returns the model-call parameters for a feature's active prompt (or {}). */
export function promptModelParams(feature: string): PromptModelParams {
  return isPromptFeature(feature) ? PROMPT_TEMPLATES[feature].modelParams : {};
}

/**
 * Renders the chat messages for a feature from its variables, using the active
 * template. Type-safe: `vars` must match the feature's variable shape.
 */
export function renderPrompt<F extends PromptFeature>(
  feature: F,
  vars: PromptVarsMap[F],
): PromptMessage[] {
  return PROMPT_TEMPLATES[feature].render(vars);
}

/**
 * Given a map of feature → the prompt version that produced its currently-stored
 * derived content, returns the features whose active prompt version no longer
 * matches — i.e. content that a prompt change has made stale and that should be
 * rebuilt. A feature absent from the map (or with a null/undefined value) is
 * treated as "unknown provenance" and is NOT reported as stale.
 *
 * This is the wiring point for "prompt changes trigger targeted rebuild/backfill"
 * (RW-020): bump a template's `version`, feed the previously-recorded versions
 * (e.g. from the AI ledger's `promptVersion` column) through this helper, and
 * enqueue a rebuild for the returned features via `runBackfill({ features,
 * mode: "rebuild", reason })`. See docs/ai-prompts.md.
 */
export function featuresWithStalePrompts(
  producedVersions: Partial<Record<string, string | null | undefined>>,
): PromptFeature[] {
  const stale: PromptFeature[] = [];
  for (const feature of PROMPT_FEATURES) {
    const produced = producedVersions[feature];
    if (produced != null && produced !== activePromptVersion(feature)) {
      stale.push(feature);
    }
  }
  return stale;
}
