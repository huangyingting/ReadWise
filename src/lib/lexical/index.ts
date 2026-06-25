/**
 * Lexical subsystem — public barrel (REF-048).
 *
 * Packages dictionary provider, word normalization, saved words, and cloze
 * generation into a single cohesive namespace.
 *
 * Module layout:
 *   normalize   — CONTRACTIONS, morphCandidates, normalizeCandidates, lemmaFor
 *   provider    — DictionaryProvider interface, FreeDictionaryProvider, types
 *   lookup      — lookupWord (provider-backed dictionary service)
 *   saved-words — getSavedWordSet, getSavedWords, saveWord, unsaveWord, …
 *   cloze       — buildCloze, gradeCloze
 *
 * Import individual sub-modules for tree-shaking in client bundles.
 * Import this barrel for server-side code that needs multiple sub-modules.
 */

export {
  CONTRACTIONS,
  morphCandidates,
  normalizeCandidates,
  lemmaFor,
} from "@/lib/lexical/normalize";

export type {
  DictionaryDefinition,
  DictionaryMeaning,
  DictionaryResult,
  DictionaryEntry,
  DictionaryProvider,
} from "@/lib/lexical/provider";

export {
  FreeDictionaryProvider,
  defaultProvider,
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

export type { ClozeCard, ClozeResult } from "@/lib/lexical/cloze";

export { buildCloze, gradeCloze } from "@/lib/lexical/cloze";
