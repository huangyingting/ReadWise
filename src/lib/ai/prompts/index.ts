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
 * (see {@link featuresWithStalePrompts} and docs/ai/prompts.md).
 *
 * Module layout:
 *   prompts/types.ts              — shared types, constants, and variable shapes
 *   prompts/translation.ts        — translation feature template
 *   prompts/vocabulary.ts         — vocabulary feature template
 *   prompts/quiz.ts               — quiz feature template
 *   prompts/tags.ts               — tags feature template
 *   prompts/difficulty.ts         — difficulty feature template
 *   prompts/grammar.ts            — grammar feature template
 *   prompts/tutor.ts              — tutor feature template
 *   prompts/sentence-translation.ts — sentence-translation feature template
 *   prompts/registry.ts           — assembles templates and exposes public API
 *   prompts/index.ts              — this file; re-exports the full public surface
 */

// Re-export all types from types.ts
export type {
  PromptRole,
  PromptMessage,
  PromptModelParams,
  PromptTemplate,
  TranslationPromptVars,
  VocabularyPromptVars,
  QuizPromptVars,
  TagsPromptVars,
  GrammarPromptVars,
  TutorPromptVars,
  SentenceTranslationPromptVars,
  PromptVarsMap,
  PromptFeature,
} from "./types";

export {
  TARGET_VOCABULARY_WORDS,
  TARGET_QUIZ_QUESTIONS,
  TARGET_TAGS,
} from "./types";

// Re-export the full public registry API
export {
  PROMPT_TEMPLATES,
  PROMPT_FEATURES,
  isPromptFeature,
  activePromptVersion,
  promptModelParams,
  renderPrompt,
  featuresWithStalePrompts,
} from "./registry";
