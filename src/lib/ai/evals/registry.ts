/**
 * Central evaluator registry. Maps feature keys to their evaluators.
 * Unknown features are rejected at evaluation time.
 */

import type { FeatureEvaluator } from "@/lib/ai/evals/types";
import { translationEvaluator } from "@/lib/ai/evals/evaluators/translation";
import { vocabularyEvaluator } from "@/lib/ai/evals/evaluators/vocabulary";
import { quizEvaluator } from "@/lib/ai/evals/evaluators/quiz";
import { grammarEvaluator } from "@/lib/ai/evals/evaluators/grammar";
import { tutorEvaluator } from "@/lib/ai/evals/evaluators/tutor";
import { safetyEvaluator } from "@/lib/ai/evals/evaluators/safety";

/** Evaluators keyed by feature. Every curated dataset must have one. */
export const EVALUATORS: Record<string, FeatureEvaluator> = {
  translation: translationEvaluator,
  vocabulary: vocabularyEvaluator,
  quiz: quizEvaluator,
  grammar: grammarEvaluator,
  tutor: tutorEvaluator,
  safety: safetyEvaluator,
};

/** Features that have an evaluator (and therefore can be evaluated). */
export const EVALUABLE_FEATURES = Object.keys(EVALUATORS);
