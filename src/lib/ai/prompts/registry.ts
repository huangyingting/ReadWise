/**
 * Prompt registry: assembles feature modules into the unified registry and
 * exposes the public API consumed by AI feature services.
 *
 * The registry API (`renderPrompt`, `activePromptVersion`, `promptModelParams`,
 * `featuresWithStalePrompts`, `PROMPT_FEATURES`) is stable — callers must not
 * need to know which module owns a feature's template.
 */

import type { PromptVarsMap, PromptFeature, PromptModelParams } from "./types";
import type { PromptTemplate, PromptMessage } from "./types";

import translationTemplate from "./translation";
import vocabularyTemplate from "./vocabulary";
import quizTemplate from "./quiz";
import tagsTemplate from "./tags";
import grammarTemplate from "./grammar";
import tutorTemplate from "./tutor";
import sentenceTranslationTemplate from "./sentence-translation";

export type { PromptTemplate, PromptMessage };

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
 * mode: "rebuild", reason })`. See docs/ai/prompts.md.
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
