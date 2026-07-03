/**
 * Feature-owned schema module for study routes (REF-043).
 * Exports body schemas, query parsers, and inferred TypeScript types so both
 * route handlers and tests can import the contracts directly.
 */

import {
  object,
  nonEmptyString,
  oneOf,
  queryInt,
  queryString,
  type Schema,
  type ValidationResult,
} from "@/lib/validation";

/** Helper: extract the validated value type from any Schema<T>. */
type InferSchema<S extends Schema<unknown>> = S extends Schema<infer T> ? T : never;

// ---------------------------------------------------------------------------
// POST /api/study/flashcards/grade
// ---------------------------------------------------------------------------

export const GRADES = ["again", "hard", "good", "easy"] as const;
export type Grade = (typeof GRADES)[number];

export const flashcardGradeBody = object({
  savedWordId: nonEmptyString(200),
  grade: oneOf(GRADES),
});

export type FlashcardGradeBody = InferSchema<typeof flashcardGradeBody>;

// ---------------------------------------------------------------------------
// GET /api/study/cloze
// ---------------------------------------------------------------------------

const CLOZE_DEFAULT_LIMIT = 20;
const CLOZE_MAX_LIMIT = 50;

export type ClozeQuery = { limit: number };

export function parseClozeQuery(
  params: URLSearchParams,
): { ok: true; value: ClozeQuery } {
  return {
    ok: true as const,
    value: {
      limit: queryInt(params, "limit", {
        fallback: CLOZE_DEFAULT_LIMIT,
        min: 1,
        max: CLOZE_MAX_LIMIT,
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// GET /api/study/words
// ---------------------------------------------------------------------------

export type WordsQuery = {
  q: string;
  articleId: string;
  filter: WordsFilter;
  page: number;
};

const WORD_FILTERS = ["all", "due", "new"] as const;
type WordsFilter = (typeof WORD_FILTERS)[number];

function isWordsFilter(value: string): value is WordsFilter {
  return (WORD_FILTERS as readonly string[]).includes(value);
}

export function parseWordsQuery(
  params: URLSearchParams,
): ValidationResult<WordsQuery> {
  const filter = queryString(params, "filter", "all");
  if (!isWordsFilter(filter)) {
    return { ok: false as const, error: 'filter must be "all", "due", or "new"' };
  }
  return {
    ok: true as const,
    value: {
      q: queryString(params, "q", ""),
      articleId: queryString(params, "articleId", ""),
      filter,
      page: queryInt(params, "page", { fallback: 1, min: 1, max: 9999 }),
    },
  };
}
