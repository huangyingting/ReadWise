/**
 * Feature-owned schema module for reader routes (REF-043).
 * Exports body schemas, query parsers, and inferred TypeScript types so both
 * route handlers and tests can import the contracts directly.
 */

import {
  object,
  nonEmptyString,
  optional,
  string,
  number,
  oneOf,
  array,
  type Schema,
} from "@/lib/validation";
import { HIGHLIGHT_NOTE_MAX } from "@/lib/annotations";
import { MAX_ACTIVE_TIME_MS } from "@/lib/engagement";

/** Helper: extract the validated value type from any Schema<T>. */
type InferSchema<S extends Schema<unknown>> = S extends Schema<infer T> ? T : never;

// Inlined from @/lib/tutor to avoid transitive import of SYSTEM_ARTICLE_CONTEXT
// Keep in sync with MAX_QUESTION_LENGTH in src/lib/tutor.ts.
const MAX_QUESTION_LENGTH = 1000;

// Inlined from @/lib/sentence-translation for the same reason.
// Keep in sync with MAX_SENTENCE_CHARS in src/lib/sentence-translation.ts.
const MAX_SENTENCE_CHARS = 1000;

// Inlined from @/lib/grammar (which imports ai-cache, which imports
// SYSTEM_ARTICLE_CONTEXT from article-access — problematic in test mocks).
// Keep in sync with MAX_PHRASE_CHARS and MAX_CONTEXT_CHARS in src/lib/grammar.ts.
const MAX_PHRASE_CHARS = 200;
const MAX_CONTEXT_CHARS = 500;

// ---------------------------------------------------------------------------
// POST /api/reader/[id]/highlights
// ---------------------------------------------------------------------------

export const createHighlightBody = object({
  quote: nonEmptyString(10_000),
  startOffset: number({ int: true, min: 0, max: 10_000_000 }),
  endOffset: number({ int: true, min: 1, max: 10_000_000 }),
  prefix: optional(string({ max: 256 })),
  suffix: optional(string({ max: 256 })),
  note: optional(string({ max: HIGHLIGHT_NOTE_MAX })),
  color: optional(nonEmptyString(20)),
});

export type CreateHighlightBody = InferSchema<typeof createHighlightBody>;

// ---------------------------------------------------------------------------
// POST /api/reader/[id]/progress
// ---------------------------------------------------------------------------

export const progressBody = object({ percent: number({ min: 0, max: 100 }) });

export type ProgressBody = InferSchema<typeof progressBody>;

// ---------------------------------------------------------------------------
// POST /api/reader/[id]/quiz/attempt
// ---------------------------------------------------------------------------

export const quizAttemptBody = object({
  answers: array(
    object({
      index: number({ int: true, min: 0, max: 1000 }),
      selectedIndex: number({ int: true, min: 0, max: 1000 }),
    }),
    { max: 1000 },
  ),
  clientMutationId: optional(nonEmptyString(100)),
});

export type QuizAttemptBody = InferSchema<typeof quizAttemptBody>;

// ---------------------------------------------------------------------------
// POST /api/reader/[id]/translate
// ---------------------------------------------------------------------------

export const translateBody = object({ lang: nonEmptyString(20) });

export type TranslateBody = InferSchema<typeof translateBody>;

// ---------------------------------------------------------------------------
// POST /api/reader/[id]/translate-sentence
// ---------------------------------------------------------------------------

export const translateSentenceBody = object({
  text: nonEmptyString(MAX_SENTENCE_CHARS),
  lang: nonEmptyString(20),
});

export type TranslateSentenceBody = InferSchema<typeof translateSentenceBody>;

// ---------------------------------------------------------------------------
// POST /api/reader/[id]/tutor
// Max characters of paragraph context accepted from the client.
// ---------------------------------------------------------------------------

const MAX_PARAGRAPH_CONTEXT = 500;

export const tutorBody = object({
  question: string({ min: 1, max: MAX_QUESTION_LENGTH }),
  /**
   * #377 — Optional paragraph context (current reading block).
   *
   * Privacy rule: this must be a substring of the article the user is
   * reading. The client only sends the current visible paragraph — never
   * any personal data, user history, or content from other articles.
   * Capped server-side to prevent prompt-injection via oversized payloads.
   */
  paragraphContext: optional(string({ max: MAX_PARAGRAPH_CONTEXT })),
});

export type TutorBody = InferSchema<typeof tutorBody>;

// ---------------------------------------------------------------------------
// POST /api/reader/[id]/difficulty-feedback
// ---------------------------------------------------------------------------

export const VOTE_VALUES = ["too_easy", "just_right", "too_hard"] as const;
export type VoteValue = (typeof VOTE_VALUES)[number];

export const difficultyFeedbackBody = object({ vote: oneOf(VOTE_VALUES) });

export type DifficultyFeedbackBody = InferSchema<typeof difficultyFeedbackBody>;

// ---------------------------------------------------------------------------
// POST /api/reader/[id]/reading-time
// ---------------------------------------------------------------------------

export const readingTimeBody = object({
  activeMs: number({ min: 0, max: MAX_ACTIVE_TIME_MS }),
});

export type ReadingTimeBody = InferSchema<typeof readingTimeBody>;

// ---------------------------------------------------------------------------
// POST /api/reader/[id]/grammar
// ---------------------------------------------------------------------------

export const grammarBody = object({
  phrase: nonEmptyString(MAX_PHRASE_CHARS),
  contextSentence: optional(string({ max: MAX_CONTEXT_CHARS })),
});

export type GrammarBody = InferSchema<typeof grammarBody>;

// ---------------------------------------------------------------------------
// GET /api/reader/[id]/offline — query param
// ---------------------------------------------------------------------------

export function parseOfflineQuery(
  params: URLSearchParams,
): { ok: true; value: { meta: boolean } } {
  return { ok: true as const, value: { meta: params.get("meta") === "1" } };
}
