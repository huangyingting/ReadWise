/**
 * Tests for src/lib/cache-version.ts (RW-044).
 *
 * Pure cache-versioning helpers — deterministic, no DOM/crypto. Covers the
 * content hash, version string construction, staleness comparison, and the
 * service-worker cache-name pruning logic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contentHash,
  makeArticleVersion,
  isOfflineStale,
  staleCacheNames,
  OFFLINE_PAYLOAD_VERSION,
  SW_CACHE_NAME,
  SW_CACHE_PREFIX,
} from "@/lib/cache-version";

// ---------------------------------------------------------------------------
// contentHash
// ---------------------------------------------------------------------------

test("contentHash is deterministic for identical input", () => {
  assert.equal(contentHash("<p>Hello</p>"), contentHash("<p>Hello</p>"));
});

test("contentHash differs for different input", () => {
  assert.notEqual(contentHash("<p>Hello</p>"), contentHash("<p>Goodbye</p>"));
});

test("contentHash is an 8-char hex string", () => {
  assert.match(contentHash("anything at all"), /^[0-9a-f]{8}$/);
});

test("contentHash handles empty input", () => {
  assert.match(contentHash(""), /^[0-9a-f]{8}$/);
});

// ---------------------------------------------------------------------------
// makeArticleVersion
// ---------------------------------------------------------------------------

test("makeArticleVersion embeds the payload version, updatedAt epoch and hash", () => {
  const hash = contentHash("body");
  const updatedAt = new Date("2026-01-02T03:04:05Z");
  const v = makeArticleVersion({ contentHash: hash, updatedAt });
  assert.equal(v, `${OFFLINE_PAYLOAD_VERSION}:${updatedAt.getTime()}:${hash}`);
});

test("makeArticleVersion changes when content changes", () => {
  const updatedAt = new Date("2026-01-02T03:04:05Z");
  const a = makeArticleVersion({ contentHash: contentHash("v1"), updatedAt });
  const b = makeArticleVersion({ contentHash: contentHash("v2"), updatedAt });
  assert.notEqual(a, b);
});

test("makeArticleVersion changes when updatedAt changes", () => {
  const hash = contentHash("body");
  const a = makeArticleVersion({ contentHash: hash, updatedAt: new Date("2026-01-01Z") });
  const b = makeArticleVersion({ contentHash: hash, updatedAt: new Date("2026-02-01Z") });
  assert.notEqual(a, b);
});

test("makeArticleVersion tolerates a null updatedAt", () => {
  const v = makeArticleVersion({ contentHash: contentHash("body"), updatedAt: null });
  assert.ok(v.startsWith(`${OFFLINE_PAYLOAD_VERSION}:0:`));
});

// ---------------------------------------------------------------------------
// isOfflineStale
// ---------------------------------------------------------------------------

test("isOfflineStale: equal versions are fresh", () => {
  assert.equal(isOfflineStale("2:100:abcd", "2:100:abcd"), false);
});

test("isOfflineStale: differing versions are stale", () => {
  assert.equal(isOfflineStale("2:100:abcd", "2:200:abcd"), true);
});

test("isOfflineStale: missing either side is stale", () => {
  assert.equal(isOfflineStale(null, "2:100:abcd"), true);
  assert.equal(isOfflineStale("2:100:abcd", undefined), true);
  assert.equal(isOfflineStale(null, null), true);
});

// ---------------------------------------------------------------------------
// staleCacheNames
// ---------------------------------------------------------------------------

test("staleCacheNames returns every readwise-* cache except the current one", () => {
  const result = staleCacheNames(
    ["readwise-v1", "readwise-v2", SW_CACHE_NAME],
    SW_CACHE_NAME,
  );
  assert.deepEqual(result.sort(), ["readwise-v1", "readwise-v2"].sort());
});

test("staleCacheNames never deletes foreign (non-prefixed) caches", () => {
  const result = staleCacheNames(
    ["workbox-precache", "some-other-cache", "readwise-v1", SW_CACHE_NAME],
    SW_CACHE_NAME,
  );
  assert.deepEqual(result, ["readwise-v1"]);
});

test("staleCacheNames returns nothing when only the current cache exists", () => {
  assert.deepEqual(staleCacheNames([SW_CACHE_NAME], SW_CACHE_NAME), []);
});

test("SW_CACHE_NAME uses the readwise- prefix", () => {
  assert.ok(SW_CACHE_NAME.startsWith(SW_CACHE_PREFIX));
});
