/**
 * Listing cache policy — single source of truth for listing cache keys
 * and invalidation tag sets (REF-039).
 *
 * Listing modules import {@link LISTING_KEYS} and {@link LISTING_TAGS} from
 * here, and cache infrastructure (`createCachedListing`, `revalidate*`,
 * `tenantCacheKeyParts`, etc.) from `@/lib/cache`.
 *
 * Using named constants instead of inline string literals guarantees a single
 * source of truth and prevents accidental key drift between registration sites
 * and invalidation sites.
 *
 * ## Invalidation ownership
 *
 * | Domain       | Invalidator               | Callers                                    |
 * | ------------ | ------------------------- | ------------------------------------------ |
 * | articles     | revalidateArticlesCache() | admin routes, processor, ingest            |
 * | tags         | revalidateTagsCache()     | admin tag routes                           |
 * | org feed     | revalidateOrgCache(id?)   | org admin routes                           |
 * | user feed    | revalidateUserCache(id)   | user profile / onboarding / article-completion mutations |
 *
 * ## CLI / worker note
 *
 * The article processor and background workers run outside a Next.js request
 * scope. Calls to `revalidateTag()` there are silently swallowed; time-based
 * revalidation (`LISTING_REVALIDATE_SECONDS`) refreshes listings instead.
 */

/**
 * Named cache-key prefixes for every public listing entry point.
 *
 * Values are `readonly` string-array tuples (Next's `unstable_cache` keyParts
 * format) so they can be passed directly to `createCachedListing` /
 * `tenantCacheKeyParts`. Using named constants instead of inline string
 * literals guarantees a single source of truth and prevents accidental key
 * drift between registration sites and invalidation sites.
 *
 * Keys follow the `domain:qualifier` convention. The EXACT strings are
 * preserved so no existing cached entries are invalidated by this refactor.
 */
function listingKey<T extends string>(key: T): readonly [T] {
  return [key] as const;
}

export const LISTING_KEYS = {
  /** Published article feed (homepage, browse). */
  published: listingKey("articles:published"),
  /** Category/level-filtered article page. */
  categoryPage: listingKey("articles:category-page"),
  /** Personalized picks page (level + topic ranked). */
  picksPage: listingKey("articles:picks-page"),
  /** Articles belonging to a given public tag slug. */
  articlesByTag: listingKey("tags:articles-by-tag"),
  /** Related articles for a single article (by shared tags). */
  relatedArticles: listingKey("tags:related-articles"),
  /** Tag taxonomy with per-tag article counts. */
  tagsWithCounts: listingKey("tags:with-counts"),
  /** User-agnostic candidate pool for the scored picks feed. */
  picksCandidates: listingKey("recommendations:picks-candidates"),
  /** Personalized "For You" feed — per user, ranked by heuristic scoring signals. */
  personalizedFeed: listingKey("feed:personalized"),
} as const satisfies Record<string, readonly string[]>;

/**
 * Canonical invalidation-tag arrays for each listing domain.
 *
 * Values MUST stay in sync with `ARTICLES_CACHE_TAG = "articles"` and
 * `TAGS_CACHE_TAG = "tags"` from `@/lib/cache`. Inline literals are used so
 * this module has no runtime dependency on `@/lib/cache` and remains safe to
 * import in test contexts that partially mock that module.
 *
 * Use these when registering a cached listing so every listing that must be
 * invalidated together receives the same tag combination. Both arrays include
 * `"articles"`; `articlesAndTags` also includes `"tags"` for listings whose
 * results change when the tag taxonomy changes.
 */
export const LISTING_TAGS = {
  /** Listings invalidated by article content changes only. */
  articles: ["articles"] as const,
  /** Listings invalidated by either article OR tag/taxonomy changes. */
  articlesAndTags: ["articles", "tags"] as const,
} as const satisfies Record<string, readonly string[]>;
