/**
 * Article listings and presentation — re-exports from article-library subsystem
 * (REF-040). This file is kept as a compatibility shim so existing importers
 * continue to resolve `@/lib/articles` without changes.
 */
export * from "@/lib/article-library/mapper";
export * from "@/lib/article-library/listings";
export {
  SEARCH_MAX_LIMIT,
  SEARCH_PAGE_SIZE,
  buildSearchTerms,
  getArticleSearchProvider,
  searchReadableArticles,
  scoreArticleSearchCandidate,
} from "@/lib/article-search";
