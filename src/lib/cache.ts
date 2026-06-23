import { unstable_cache, revalidateTag } from "next/cache";
import { recordCacheLookup, recordCacheMiss } from "@/lib/metrics";

/**
 * Tag-based server-side caching for expensive listing/recommendation queries.
 *
 * Listing helpers (category/picks/tag/related/published feeds) are wrapped with
 * {@link createCachedListing} so their results are cached in Next's Data Cache
 * keyed by the call arguments. When underlying content changes, the relevant
 * tag is invalidated so the next request recomputes — no stale listings.
 */

/** Invalidated whenever published-article content changes. */
export const ARTICLES_CACHE_TAG = "articles";

/** Invalidated whenever tags / article-tag links change. */
export const TAGS_CACHE_TAG = "tags";

/**
 * Soft revalidation window (seconds). Tag invalidation makes admin
 * edit/delete/rebuild precise; this is only a safety net so content published
 * out-of-band (the CLI worker/processor runs outside a request and therefore
 * cannot call `revalidateTag`) still becomes visible within a bounded time.
 */
export const LISTING_REVALIDATE_SECONDS = 300;

/**
 * Wraps an async query in Next's `unstable_cache`. The function arguments are
 * automatically part of the cache key (so paginated/per-level calls are cached
 * independently); `keyParts` namespaces the entry and `tags` controls
 * invalidation.
 */
export function createCachedListing<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
  keyParts: string[],
  tags: string[],
  revalidate: number | false = LISTING_REVALIDATE_SECONDS,
): (...args: Args) => Promise<T> {
  const cacheName = keyParts.join(":");
  const cached = unstable_cache(
    async (...args: Args) => {
      recordCacheMiss(cacheName);
      return fn(...args);
    },
    keyParts,
    { tags, revalidate },
  );
  return (...args: Args) => {
    recordCacheLookup(cacheName);
    return cached(...args);
  };
}

function safeRevalidate(tag: string): void {
  try {
    revalidateTag(tag);
  } catch {
    // Called outside a Next.js request scope (e.g. the CLI worker/processor).
    // The time-based revalidation window refreshes listings instead.
  }
}

/** Invalidates all cached article listings and recommendations. */
export function revalidateArticlesCache(): void {
  safeRevalidate(ARTICLES_CACHE_TAG);
}

/**
 * Invalidates tag-derived listings. Tag changes also affect article feeds
 * (related articles, tag counts), so the articles tag is invalidated too.
 */
export function revalidateTagsCache(): void {
  safeRevalidate(TAGS_CACHE_TAG);
  safeRevalidate(ARTICLES_CACHE_TAG);
}
