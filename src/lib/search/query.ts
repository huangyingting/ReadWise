/**
 * Query parsing, tokenization, pagination limits, and Prisma WHERE-clause
 * builders for the article search subsystem.
 *
 * No Prisma client instance is imported here — all functions are pure or
 * depend only on Prisma *types* (Prisma.ArticleWhereInput etc.).
 */
import { type Prisma } from "@prisma/client";

/** Default and maximum page sizes for the user-facing global search. */
export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_MAX_LIMIT = 50;

/** Hard cap for low-priority SQLite-safe Prisma candidate buckets; PostgreSQL FTS replaces this after #259. */
export const SEARCH_CANDIDATE_LIMIT = 500;

export type SearchOptions = {
  offset?: number;
  limit?: number;
};

export type SearchContext = {
  userId?: string | null;
  role?: string | null;
};

export type StringContainsFilter = { contains: string; mode?: "insensitive" };

export const ARTICLE_SEARCH_FIELDS = ["title", "excerpt", "content", "author", "source", "category"] as const;
export const TITLE_ARTICLE_SEARCH_FIELDS = ["title"] as const;
export const BYLINE_ARTICLE_SEARCH_FIELDS = ["author", "source"] as const;
export const HIGHLIGHT_SEARCH_FIELDS = ["quote", "note"] as const;
export const SAVED_WORD_SEARCH_FIELDS = ["word", "explanation", "example", "contextSentence"] as const;

/**
 * Tokenizes a user query for portable Prisma `contains` searches. This avoids
 * SQLite FTS5 syntax entirely today while keeping the call site behind
 * ArticleSearchProvider so a PostgreSQL tsvector/ts_rank implementation can be
 * dropped in after the PostgreSQL migration in #259.
 */
export function buildSearchTerms(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .trim()
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .map((term) => term.trim())
        .filter((term) => term.length > 0)
        .slice(0, 8),
    ),
  );
}

export function isPostgresDatabase(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

export function containsFilter(value: string): StringContainsFilter {
  return isPostgresDatabase() ? { contains: value, mode: "insensitive" } : { contains: value };
}

export function candidateTake(offset: number, limit: number): number {
  return Math.min(SEARCH_CANDIDATE_LIMIT, Math.max(limit + 1, offset + limit + 1 + 50));
}

export function priorityTake(offset: number, limit: number): number {
  return Math.min(SEARCH_CANDIDATE_LIMIT, offset + limit + 1);
}

export function articleFieldsWhere(
  fields: readonly (typeof ARTICLE_SEARCH_FIELDS)[number][],
  terms: string[],
): Prisma.ArticleWhereInput {
  const perTerm = terms.map((term) => ({
    OR: fields.map((field) => ({ [field]: containsFilter(term) })),
  })) as Prisma.ArticleWhereInput[];
  return perTerm.length === 1 ? perTerm[0] : { AND: perTerm };
}

export function articleTextWhere(terms: string[]): Prisma.ArticleWhereInput {
  return articleFieldsWhere(ARTICLE_SEARCH_FIELDS, terms);
}

export function articleExactWhere(
  fields: readonly (typeof ARTICLE_SEARCH_FIELDS)[number][],
  query: string,
): Prisma.ArticleWhereInput {
  return { OR: fields.map((field) => ({ [field]: containsFilter(query) })) };
}

export function highlightTextWhere(terms: string[]): Prisma.HighlightWhereInput {
  const perTerm = terms.map((term) => ({
    OR: HIGHLIGHT_SEARCH_FIELDS.map((field) => ({ [field]: containsFilter(term) })),
  })) as Prisma.HighlightWhereInput[];
  return perTerm.length === 1 ? perTerm[0] : { AND: perTerm };
}

export function savedWordTextWhere(terms: string[]): Prisma.SavedWordWhereInput {
  const perTerm = terms.map((term) => ({
    OR: SAVED_WORD_SEARCH_FIELDS.map((field) => ({ [field]: containsFilter(term) })),
  })) as Prisma.SavedWordWhereInput[];
  return perTerm.length === 1 ? perTerm[0] : { AND: perTerm };
}
