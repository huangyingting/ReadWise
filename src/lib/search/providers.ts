/**
 * Article search provider registry (ARCH-15).
 *
 * Exposes the provider interface and a registry seam so alternative
 * implementations (semantic/vector, cloud search, etc.) can be registered
 * without touching call sites. Mirrors the AI/storage registry pattern.
 *
 * Default provider: `PrismaArticleSearchProvider` (fulltext.ts) — portable
 * Prisma `contains` search with PostgreSQL FTS augmentation.
 *
 * Adding a new provider:
 *   1. Implement `ArticleSearchProvider` in a new file under `search/`.
 *   2. Call `registerSearchProvider(provider)` during app startup / config.
 *   3. No other modules need editing.
 */
import type { ArticlePage } from "@/lib/article-library";
import type { SearchOptions, SearchContext } from "@/lib/search/query";
import { PrismaArticleSearchProvider } from "./fulltext";

export type { ArticlePage };

export type ArticleSearchProvider = {
  name: string;
  search(query: string, opts: SearchOptions, context?: SearchContext | null): Promise<ArticlePage>;
};

let _provider: ArticleSearchProvider = new PrismaArticleSearchProvider();

/**
 * Registers a custom article search provider, replacing the default
 * `PrismaArticleSearchProvider`. Call this once during application startup
 * (e.g. in a runtime-config module) before any searches are issued.
 */
export function registerSearchProvider(provider: ArticleSearchProvider): void {
  _provider = provider;
}

/**
 * Returns the currently active article search provider.
 * Defaults to `PrismaArticleSearchProvider` unless overridden by
 * `registerSearchProvider`.
 */
export function resolveSearchProvider(): ArticleSearchProvider {
  return _provider;
}

/** @deprecated Use `resolveSearchProvider()` instead. */
export function getArticleSearchProvider(): ArticleSearchProvider {
  return resolveSearchProvider();
}

/**
 * Article search entry point used by `/api/search`.
 * Searches readable articles — authenticated users may also see their own
 * imported articles and their own annotation/vocabulary matches; all results
 * pass through `readableArticleWhere` to preserve Wave 1 visibility rules.
 */
export function searchReadableArticles(
  query: string,
  opts: SearchOptions = {},
  userId?: string,
): Promise<ArticlePage> {
  return resolveSearchProvider().search(query, opts, userId ? { userId, role: "Reader" } : null);
}

