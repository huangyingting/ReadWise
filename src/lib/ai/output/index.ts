/**
 * AI safety/output package — public barrel (REF-067).
 *
 * Packages all AI output contracts into a single cohesive subsystem:
 *   - {@link "./validators"} — structured-output validators (vocabulary, quiz, tags)
 *   - {@link "./moderation"} — free-text moderation with heuristic denylist
 *   - {@link "./error-classifier"} — provider error classification helpers
 *
 * Import from this barrel for the narrowest public API:
 *   import { validateVocabulary, moderateText, classifyHttpStatus } from "@/lib/ai/output";
 *
 * Or import from a specific submodule for more granular control:
 *   import { validateVocabulary } from "@/lib/ai/output/validators";
 *   import { moderateText } from "@/lib/ai/output/moderation";
 *   import { classifyHttpStatus } from "@/lib/ai/output/error-classifier";
 */

export * from "./validators";
export * from "./moderation";
export * from "./error-classifier";
