/**
 * Lexical subsystem — public barrel (REF-048).
 *
 * Packages dictionary provider, word normalization, and saved words into a
 * single cohesive namespace. Learning cloze helpers stay owned by
 * `@/lib/learning/cloze` (no cross-domain re-export).
 *
 * Module layout:
 *   normalize   — CONTRACTIONS, morphCandidates, normalizeCandidates, lemmaFor
 *   provider    — DictionaryProvider interface + dictionary result contracts
 *   lookup      — lookupWord (provider-backed dictionary service)
 *   saved-words — getSavedWordSet, getSavedWords, saveWord, unsaveWord, …
 *
 * Structural relationship:
 *   `@/lib/vocabulary.ts` (AI extraction service) depends on lexical saved-word
 *   APIs for "saved/not saved" joins; lexical does not depend on vocabulary.
 *
 * Import individual sub-modules for feature-specific behavior.
 * Import this barrel for lexical contracts + high-level lookup/saved-word APIs.
 */

export {
  CONTRACTIONS,
  IRREGULAR_BASES,
  morphCandidates,
  normalizeCandidates,
  lemmaFor,
} from "@/lib/lexical/normalize";

export type {
  DictionaryDefinition,
  DictionaryMeaning,
  DictionaryResult,
  DictionaryProvider,
} from "@/lib/lexical/provider";

export { lookupWord } from "@/lib/lexical/lookup";

export type {
  SavedWordView,
  FilteredWordsResult,
} from "@/lib/lexical/saved-words";

export {
  WORDS_PAGE_SIZE,
  getSavedWordSet,
  getSavedWords,
  getFilteredSavedWords,
  saveWord,
  unsaveWord,
} from "@/lib/lexical/saved-words";
