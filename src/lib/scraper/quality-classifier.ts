/**
 * Local Naive-Bayes ad/article text classifier (Issue #739 follow-up).
 *
 * Loads a small, committed `natural` Bayes model (`quality-classifier-model.json`)
 * and labels a block of plain article text as `"article"` or `"ad"`. This runs
 * entirely locally with no network and no heavy model — it is a complementary
 * signal for {@link import("./quality").checkContentQuality}, never the sole
 * basis for rejecting content.
 *
 * @server-only — uses `node:module`/`node:fs` and the Node-only `natural`
 * package; never import from a "use client" file.
 *
 * Robustness: if the model file is missing/unreadable or the text is too short
 * to be meaningful, {@link classifyArticleText} returns a NEUTRAL result
 * (`{ label: "article", confidence: 0 }`) instead of throwing.
 *
 * PRIVACY: classifies already-public scraped article text and NEVER logs or
 * persists the input. Only the resulting label/confidence (no text) is returned.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Result of classifying a block of article text. */
export type ClassifierResult = {
  /** Predicted label. */
  label: "article" | "ad";
  /**
   * Normalized confidence in `[0, 1]` for {@link ClassifierResult.label}.
   * `0` is the neutral/no-signal value returned when classification is skipped.
   */
  confidence: number;
};

/** Minimum word count required before the classifier will attempt a label. */
export const CLASSIFIER_MIN_WORDS = 20;

/** Neutral result used when the classifier cannot/should not produce a label. */
const NEUTRAL: ClassifierResult = { label: "article", confidence: 0 };

// Minimal structural typing for the slice of `natural` we depend on, so we can
// avoid `any` while loading the package via `require`.
type Classification = { label: string; value: number };
type BayesClassifierInstance = {
  getClassifications(text: string): Classification[];
};
type NaturalModule = {
  BayesClassifier: {
    restore(model: unknown): BayesClassifierInstance;
  };
};

// Lazy, cached classifier. `undefined` = not yet attempted; `null` = attempted
// and unavailable (missing model or load failure) — cached so we don't retry on
// every call.
let cached: BayesClassifierInstance | null | undefined;

/** Loads and caches the committed model, returning `null` if unavailable. */
function loadClassifier(): BayesClassifierInstance | null {
  if (cached !== undefined) return cached;
  try {
    const natural = require("natural") as NaturalModule;
    const model = require("./quality-classifier-model.json");
    cached = natural.BayesClassifier.restore(model);
  } catch {
    // Missing model, parse error, or natural not installed — degrade to neutral.
    cached = null;
  }
  return cached;
}

/**
 * Classifies `text` as genuine article prose or ad/junk copy.
 *
 * Returns a neutral result (`confidence: 0`) when the text is too short, when
 * the model is unavailable, or on any internal error — this function never
 * throws.
 */
export function classifyArticleText(text: string): ClassifierResult {
  const trimmed = typeof text === "string" ? text.trim() : "";
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
  if (wordCount < CLASSIFIER_MIN_WORDS) return NEUTRAL;

  const classifier = loadClassifier();
  if (!classifier) return NEUTRAL;

  try {
    const classifications = classifier.getClassifications(trimmed);
    if (!Array.isArray(classifications) || classifications.length === 0) return NEUTRAL;

    // `getClassifications` returns entries sorted best-first with raw (unnormalized)
    // likelihood values; normalize the top value into a [0, 1] confidence.
    const total = classifications.reduce((sum, c) => sum + (c.value || 0), 0);
    const top = classifications[0]!;
    const confidence = total > 0 ? top.value / total : 0;
    const label = top.label === "ad" ? "ad" : "article";
    return { label, confidence };
  } catch {
    return NEUTRAL;
  }
}

/** Test-only: resets the cached classifier so a fresh load is attempted. */
export function __resetClassifierCacheForTests(): void {
  cached = undefined;
}
