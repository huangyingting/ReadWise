/**
 * Dictionary lookup — re-exported from the lexical subsystem (REF-048).
 *
 * This file is kept for backward compatibility. Prefer importing directly
 * from `@/lib/lexical` or `@/lib/lexical/lookup` in new code.
 *
 * Word forms (plurals, gerunds, past tenses, comparatives, contractions and
 * possessives) are normalized to an ordered list of candidate base forms; the
 * first form that resolves against the Free Dictionary API wins. Following the
 * project's graceful-fallback convention, network/lookup failures degrade to a
 * clear "not found" result instead of throwing.
 */

export type {
  DictionaryDefinition,
  DictionaryMeaning,
  DictionaryResult,
} from "@/lib/lexical/provider";

// Re-export normalizeCandidates so existing imports of it from this module continue to work.
export { normalizeCandidates } from "@/lib/lexical/normalize";

export { lookupWord } from "@/lib/lexical/lookup";
