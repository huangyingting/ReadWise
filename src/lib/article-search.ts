/**
 * Public API for article search. All implementation has been split into
 * focused modules under `src/lib/search/`:
 *
 *   - `search/query.ts`       — tokenization, limits, Prisma WHERE builders
 *   - `search/ranking.ts`     — candidate types, scoring, sort (no DB client)
 *   - `search/annotations.ts` — highlight/saved-word article-ID lookup
 *   - `search/providers.ts`   — ArticleSearchProvider interface + implementations
 *
 * This file re-exports the full public surface so existing callers (articles.ts,
 * /api/search, and tests) continue to resolve `@/lib/article-search` without
 * changes.
 */
export {
  SEARCH_PAGE_SIZE,
  SEARCH_MAX_LIMIT,
  SEARCH_CANDIDATE_LIMIT,
  type SearchOptions,
  type SearchContext,
  buildSearchTerms,
} from "@/lib/search/query";

export {
  type SearchSource,
  type SearchCandidate,
  scoreArticleSearchCandidate,
  putCandidate,
  sortCandidates,
} from "@/lib/search/ranking";

export { userAnnotationArticleIds } from "@/lib/search/annotations";

export {
  type ArticlePage,
  type ArticleSearchProvider,
  PrismaArticleSearchProvider,
  getArticleSearchProvider,
  searchReadableArticles,
} from "@/lib/search/providers";
