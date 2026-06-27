import { unstable_cache, revalidateTag } from "next/cache";
import { recordCacheLookup, recordCacheMiss } from "@/lib/metrics";

/**
 * Tag-based server-side caching for expensive listing/recommendation queries.
 *
 * @server-only — Must never be imported from a "use client" file or any module
 * that can enter a client bundle. Uses `next/cache` APIs (unstable_cache,
 * revalidateTag) which are server-only. See ADR-0010.
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
 * Base tag for ALL organization/tenant-scoped feeds (RW-062). Per-org feeds are
 * additionally tagged with {@link orgCacheTag} so a single org can be
 * invalidated without busting every tenant's cache. Public feeds NEVER carry
 * this tag — they keep their existing global {@link ARTICLES_CACHE_TAG} keys.
 */
export const ORG_CACHE_TAG = "org";

/** Per-organization invalidation tag, e.g. `org:abc123`. */
export function orgCacheTag(orgId: string): string {
  return `${ORG_CACHE_TAG}:${normalizeTenantId(orgId)}`;
}

/** Per-user invalidation tag for personalized (non-shareable) feeds. */
export function userCacheTag(userId: string): string {
  return `user:${normalizeTenantId(userId)}`;
}

function normalizeTenantId(id: string | null | undefined): string {
  const trimmed = (id ?? "").trim();
  return trimmed.length > 0 ? trimmed : "unknown";
}

/**
 * Cache visibility scope (RW-062):
 *   - `public` — global, shareable content. Key parts are UNCHANGED so public
 *     listings keep their exact current keys (no behavior change).
 *   - `user`   — personalized, per-user content (never shareable across users).
 *   - `org`    — tenant-specific content, isolated per organization.
 */
export type CacheScope = "public" | "user" | "org";

/**
 * Soft revalidation window (seconds). Tag invalidation makes admin
 * edit/delete/rebuild precise; this is only a safety net so content published
 * out-of-band (the CLI worker/processor runs outside a request and therefore
 * cannot call `revalidateTag`) still becomes visible within a bounded time.
 */
export const LISTING_REVALIDATE_SECONDS = 300;

function isListingCacheDisabled(): boolean {
  return process.env.READWISE_DISABLE_LISTING_CACHE === "1";
}

/**
 * Wraps an async query in Next's `unstable_cache`. The function arguments are
 * automatically part of the cache key (so paginated/per-level calls are cached
 * independently); `keyParts` namespaces the entry and `tags` controls
 * invalidation.
 */
export function createCachedListing<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
  keyParts: readonly string[],
  tags: readonly string[],
  revalidate: number | false = LISTING_REVALIDATE_SECONDS,
): (...args: Args) => Promise<T> {
  const cacheName = keyParts.join(":");
  if (isListingCacheDisabled()) {
    return (...args: Args) => {
      recordCacheLookup(cacheName);
      recordCacheMiss(cacheName);
      return fn(...args);
    };
  }
  const cached = unstable_cache(
    async (...args: Args) => {
      recordCacheMiss(cacheName);
      return fn(...args);
    },
    [...keyParts],
    { tags: [...tags], revalidate },
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

/**
 * PURE cache-key builder (RW-062). The contract that prevents private/tenant
 * content leaking through a shared key:
 *   - `public`: returns `keyParts` UNCHANGED — public listings keep their exact
 *     current keys, so behavior is identical.
 *   - `user`/`org`: APPENDS the scope-qualified tenant id, so a per-user or
 *     per-org feed can never collide with a public key OR with another tenant's
 *     key (two different orgs produce two different key arrays).
 */
export function tenantCacheKeyParts(
  keyParts: readonly string[],
  scope: CacheScope,
  tenantId?: string | null,
): string[] {
  if (scope === "public") return [...keyParts];
  const tag = scope === "org" ? orgCacheTag(tenantId ?? "") : userCacheTag(tenantId ?? "");
  return [...keyParts, tag];
}

/** Invalidation tags for a scoped listing (base tags + the scope tag(s)). */
function tenantCacheTags(
  scope: CacheScope,
  tenantId: string,
  extra: readonly string[] = [],
): string[] {
  if (scope === "org") return [...extra, ORG_CACHE_TAG, orgCacheTag(tenantId)];
  if (scope === "user") return [...extra, userCacheTag(tenantId)];
  return [...extra];
}

/**
 * Maximum number of per-tenant `unstable_cache` instances kept in memory.
 * When the limit is reached the oldest tenant entry (by insertion order) is
 * evicted. 500 covers any realistic multi-tenant deployment while keeping the
 * in-process footprint bounded (BE-10).
 */
export const MAX_TENANT_CACHE_SIZE = 500;

/**
 * Tenant-aware variant of {@link createCachedListing} (RW-062). The wrapped
 * function MUST take the tenant id (orgId for `org` scope, userId for `user`
 * scope) as its FIRST argument — that id is woven into BOTH the cache key (via
 * {@link tenantCacheKeyParts}) and the invalidation tags (via
 * {@link tenantCacheTags}). A distinct `unstable_cache` instance is memoized per
 * tenant so per-org invalidation is precise. The memoization map is bounded at
 * {@link MAX_TENANT_CACHE_SIZE} entries; the oldest tenant is evicted (LRU by
 * insertion order) when the limit is hit. Use this for any NEW org/private
 * feed; keep public feeds on {@link createCachedListing}.
 */
export function createTenantCachedListing<Args extends unknown[], T>(
  fn: (tenantId: string, ...args: Args) => Promise<T>,
  keyParts: readonly string[],
  scope: "user" | "org",
  opts: { tags?: readonly string[]; revalidate?: number | false } = {},
): (tenantId: string, ...args: Args) => Promise<T> {
  const baseName = keyParts.join(":");
  if (isListingCacheDisabled()) {
    return (tenantId: string, ...args: Args) => {
      const id = normalizeTenantId(tenantId);
      const cacheName = `${baseName}:${scope}:${id}`;
      recordCacheLookup(cacheName);
      recordCacheMiss(cacheName);
      return fn(id, ...args);
    };
  }
  const revalidate = opts.revalidate ?? LISTING_REVALIDATE_SECONDS;
  const perTenant = new Map<string, (tenantId: string, ...args: Args) => Promise<T>>();

  return (tenantId: string, ...args: Args) => {
    const id = normalizeTenantId(tenantId);
    const cacheName = `${baseName}:${scope}:${id}`;
    recordCacheLookup(cacheName);
    let cached = perTenant.get(id);
    if (!cached) {
      // Evict the oldest tenant entry when the size limit is reached.
      if (perTenant.size >= MAX_TENANT_CACHE_SIZE) {
        const oldest = perTenant.keys().next().value as string | undefined;
        if (oldest !== undefined) perTenant.delete(oldest);
      }
      cached = unstable_cache(
        async (innerId: string, ...inner: Args) => {
          recordCacheMiss(cacheName);
          return fn(innerId, ...inner);
        },
        tenantCacheKeyParts(keyParts, scope, id),
        { tags: tenantCacheTags(scope, id, opts.tags), revalidate },
      );
      perTenant.set(id, cached);
    }
    return cached(id, ...args);
  };
}

/** Invalidates all cached article listings and recommendations. */
export function revalidateArticlesCache(): void {
  safeRevalidate(ARTICLES_CACHE_TAG);
}

/**
 * Invalidates tenant/org-scoped feeds (RW-062). With an `orgId`, only THAT
 * organization's feeds are busted (precise); without one, the umbrella
 * {@link ORG_CACHE_TAG} is invalidated (all tenant feeds). Public feeds are
 * untouched — invalidate those via {@link revalidateArticlesCache}.
 */
export function revalidateOrgCache(orgId?: string | null): void {
  if (orgId && orgId.trim()) {
    safeRevalidate(orgCacheTag(orgId));
    return;
  }
  safeRevalidate(ORG_CACHE_TAG);
}

/**
 * Invalidates tag-derived listings. Tag changes also affect article feeds
 * (related articles, tag counts), so the articles tag is invalidated too.
 */
export function revalidateTagsCache(): void {
  safeRevalidate(TAGS_CACHE_TAG);
  safeRevalidate(ARTICLES_CACHE_TAG);
}

/**
 * Invalidates personalized (user-scoped) feeds for a single user. Callers are
 * responsible for ensuring `userId` comes from the server session, not from a
 * request body.
 */
export function revalidateUserCache(userId: string): void {
  safeRevalidate(userCacheTag(userId));
}
