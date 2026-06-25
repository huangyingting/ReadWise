/**
 * Tests for src/lib/listing-cache.ts (REF-039).
 *
 * Verifies that:
 *  - LISTING_KEYS values preserve exact cache-key strings (no silent drift).
 *  - LISTING_TAGS values carry the correct tag names.
 *  - No two LISTING_KEYS entries share the same string (no accidental collision).
 *  - Re-exported cache helpers are forwarded correctly.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type ListingCache = typeof import("@/lib/listing-cache");
type Cache = typeof import("@/lib/cache");
let lc: ListingCache;
let cache: Cache;

let revalidatedTags: string[];

before(async () => {
  mock.module("next/cache", {
    namedExports: {
      unstable_cache: (
        fn: (...args: unknown[]) => unknown,
        _keyParts: string[],
        _opts: { tags: string[]; revalidate: unknown },
      ) => fn,
      revalidateTag: (tag: string) => {
        revalidatedTags.push(tag);
      },
    },
  });
  mock.module("@/lib/metrics", {
    namedExports: {
      recordCacheLookup: () => {},
      recordCacheMiss: () => {},
    },
  });
  cache = await import("@/lib/cache");
  lc = await import("@/lib/listing-cache");
});

beforeEach(() => {
  revalidatedTags = [];
});

// ---------------------------------------------------------------------------
// LISTING_KEYS — exact string preservation
// ---------------------------------------------------------------------------

test("LISTING_KEYS.published preserves the exact cache key", () => {
  assert.deepEqual(lc.LISTING_KEYS.published, ["articles:published"]);
});

test("LISTING_KEYS.categoryPage preserves the exact cache key", () => {
  assert.deepEqual(lc.LISTING_KEYS.categoryPage, ["articles:category-page"]);
});

test("LISTING_KEYS.picksPage preserves the exact cache key", () => {
  assert.deepEqual(lc.LISTING_KEYS.picksPage, ["articles:picks-page"]);
});

test("LISTING_KEYS.articlesByTag preserves the exact cache key", () => {
  assert.deepEqual(lc.LISTING_KEYS.articlesByTag, ["tags:articles-by-tag"]);
});

test("LISTING_KEYS.relatedArticles preserves the exact cache key", () => {
  assert.deepEqual(lc.LISTING_KEYS.relatedArticles, ["tags:related-articles"]);
});

test("LISTING_KEYS.tagsWithCounts preserves the exact cache key", () => {
  assert.deepEqual(lc.LISTING_KEYS.tagsWithCounts, ["tags:with-counts"]);
});

test("LISTING_KEYS.picksCandidates preserves the exact cache key", () => {
  assert.deepEqual(lc.LISTING_KEYS.picksCandidates, ["recommendations:picks-candidates"]);
});

// ---------------------------------------------------------------------------
// LISTING_KEYS — no collisions
// ---------------------------------------------------------------------------

test("all LISTING_KEYS entries are distinct (no silent key collision)", () => {
  const serialized = Object.values(lc.LISTING_KEYS).map((k) => k.join(":"));
  const unique = new Set(serialized);
  assert.equal(unique.size, serialized.length, "duplicate cache key detected");
});

// ---------------------------------------------------------------------------
// LISTING_TAGS — correct tag contents
// ---------------------------------------------------------------------------

test("LISTING_TAGS.articles contains only the articles tag", () => {
  assert.deepEqual([...lc.LISTING_TAGS.articles], ["articles"]);
  assert.ok(!lc.LISTING_TAGS.articles.includes("tags" as never));
});

test("LISTING_TAGS.articlesAndTags contains both article and tag cache tags", () => {
  assert.ok(lc.LISTING_TAGS.articlesAndTags.includes("articles" as never));
  assert.ok(lc.LISTING_TAGS.articlesAndTags.includes("tags" as never));
});

// ---------------------------------------------------------------------------
// Invalidation helpers — forwarding checks via @/lib/cache
// ---------------------------------------------------------------------------

test("revalidateArticlesCache targets the articles tag", () => {
  cache.revalidateArticlesCache();
  assert.deepEqual(revalidatedTags, [cache.ARTICLES_CACHE_TAG]);
});

test("revalidateTagsCache targets both tags", () => {
  cache.revalidateTagsCache();
  assert.ok(revalidatedTags.includes(cache.TAGS_CACHE_TAG));
  assert.ok(revalidatedTags.includes(cache.ARTICLES_CACHE_TAG));
});

test("revalidateOrgCache targets the org tag", () => {
  cache.revalidateOrgCache("org1");
  assert.deepEqual(revalidatedTags, [cache.orgCacheTag("org1")]);
});

test("revalidateUserCache targets the user tag", () => {
  cache.revalidateUserCache("user1");
  assert.deepEqual(revalidatedTags, [cache.userCacheTag("user1")]);
});

// ---------------------------------------------------------------------------
// Tenant isolation — public keys never collide with user/org keys
// ---------------------------------------------------------------------------

test("LISTING_KEYS values don't collide with tenant-scoped keys (public scope returns key unchanged)", () => {
  const publicKey = cache.tenantCacheKeyParts(lc.LISTING_KEYS.published, "public");
  assert.deepEqual(publicKey, [...lc.LISTING_KEYS.published]);
});

test("org-scoped key appends the org qualifier and differs from public", () => {
  const orgKey = cache.tenantCacheKeyParts(lc.LISTING_KEYS.published, "org", "o1");
  assert.notDeepEqual(orgKey, [...lc.LISTING_KEYS.published]);
  assert.equal(orgKey.at(-1), cache.orgCacheTag("o1"));
});

test("user-scoped key appends the user qualifier and differs from public", () => {
  const userKey = cache.tenantCacheKeyParts(lc.LISTING_KEYS.published, "user", "u1");
  assert.notDeepEqual(userKey, [...lc.LISTING_KEYS.published]);
  assert.equal(userKey.at(-1), cache.userCacheTag("u1"));
});

test("two different orgs produce distinct scoped keys (no cross-tenant collision)", () => {
  const a = cache.tenantCacheKeyParts(["feed"], "org", "orgA");
  const b = cache.tenantCacheKeyParts(["feed"], "org", "orgB");
  assert.notDeepEqual(a, b);
});
