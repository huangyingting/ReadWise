/**
 * Tenant-aware cache-key tests (RW-062).
 *
 * `next/cache` and `@/lib/metrics` are mocked so the REAL `@/lib/cache` can be
 * exercised: `unstable_cache` is captured (to inspect the key parts + tags a
 * listing is registered with) and `revalidateTag` is recorded. Proves public
 * keys are unchanged, tenant keys append a scope-qualified id (no cross-tenant
 * collision), and per-org invalidation targets the right tag.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type Cache = typeof import("@/lib/cache");
let cache: Cache;

let cacheCalls: { keyParts: string[]; opts: { tags: string[]; revalidate: unknown } }[];
let revalidatedTags: string[];

before(async () => {
  mock.module("next/cache", {
    namedExports: {
      unstable_cache: (
        fn: (...args: unknown[]) => unknown,
        keyParts: string[],
        opts: { tags: string[]; revalidate: unknown },
      ) => {
        cacheCalls.push({ keyParts, opts });
        return fn;
      },
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
});

beforeEach(() => {
  cacheCalls = [];
  revalidatedTags = [];
});

// ---------------------------------------------------------------------------
// tenantCacheKeyParts (pure)
// ---------------------------------------------------------------------------

test("public scope leaves key parts UNCHANGED (no behavior change)", () => {
  assert.deepEqual(cache.tenantCacheKeyParts(["articles", "p1"], "public"), ["articles", "p1"]);
  // A tenant id is ignored for the public scope.
  assert.deepEqual(cache.tenantCacheKeyParts(["articles"], "public", "org-x"), ["articles"]);
});

test("org / user scope append a scope-qualified tenant id", () => {
  assert.deepEqual(cache.tenantCacheKeyParts(["feed"], "org", "o1"), ["feed", "org:o1"]);
  assert.deepEqual(cache.tenantCacheKeyParts(["feed"], "user", "u1"), ["feed", "user:u1"]);
});

test("different orgs never collide on a cache key", () => {
  const a = cache.tenantCacheKeyParts(["feed"], "org", "o1");
  const b = cache.tenantCacheKeyParts(["feed"], "org", "o2");
  assert.notDeepEqual(a, b);
  // ...and neither collides with the public key.
  assert.notDeepEqual(a, cache.tenantCacheKeyParts(["feed"], "public"));
});

test("tag builders are namespaced", () => {
  assert.equal(cache.orgCacheTag("o1"), "org:o1");
  assert.equal(cache.userCacheTag("u1"), "user:u1");
  assert.equal(cache.ORG_CACHE_TAG, "org");
});

// ---------------------------------------------------------------------------
// createTenantCachedListing
// ---------------------------------------------------------------------------

test("createTenantCachedListing weaves the org id into key + tags, isolated per tenant", async () => {
  const listing = cache.createTenantCachedListing(
    async (orgId: string, page: number) => `${orgId}#${page}`,
    ["orgfeed"],
    "org",
  );

  assert.equal(await listing("orgA", 1), "orgA#1");
  assert.equal(await listing("orgB", 1), "orgB#1");

  // Two distinct tenants ⇒ two unstable_cache instances with distinct keys.
  assert.equal(cacheCalls.length, 2);
  assert.deepEqual(cacheCalls[0].keyParts, ["orgfeed", "org:orgA"]);
  assert.deepEqual(cacheCalls[1].keyParts, ["orgfeed", "org:orgB"]);

  // Org-scoped tags carry BOTH the umbrella tag and the per-org tag.
  assert.ok(cacheCalls[0].opts.tags.includes("org"));
  assert.ok(cacheCalls[0].opts.tags.includes("org:orgA"));
  assert.ok(!cacheCalls[0].opts.tags.includes("org:orgB"));

  // Re-using the same tenant reuses the memoized instance (no new registration).
  assert.equal(await listing("orgA", 2), "orgA#2");
  assert.equal(cacheCalls.length, 2);
});

test("createTenantCachedListing user scope tags per-user, not org", async () => {
  const listing = cache.createTenantCachedListing(
    async (userId: string) => `me:${userId}`,
    ["userfeed"],
    "user",
  );
  assert.equal(await listing("u1"), "me:u1");
  assert.deepEqual(cacheCalls[0].keyParts, ["userfeed", "user:u1"]);
  assert.ok(cacheCalls[0].opts.tags.includes("user:u1"));
  assert.ok(!cacheCalls[0].opts.tags.includes("org"));
});

// ---------------------------------------------------------------------------
// Invalidation
// ---------------------------------------------------------------------------

test("revalidateOrgCache targets one org, or the umbrella tag", () => {
  cache.revalidateOrgCache("orgA");
  assert.deepEqual(revalidatedTags, ["org:orgA"]);

  revalidatedTags = [];
  cache.revalidateOrgCache();
  assert.deepEqual(revalidatedTags, ["org"]);
});

test("public invalidation is unaffected by the tenant tags", () => {
  cache.revalidateArticlesCache();
  assert.deepEqual(revalidatedTags, ["articles"]);
});
