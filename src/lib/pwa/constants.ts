/**
 * PWA/offline runtime constants — single import point (REF-056).
 *
 * Re-exports every constant that governs the offline/PWA runtime from its
 * authoritative TypeScript source.  `public/sw.js` and
 * `public/offline-reader.html` are static files that cannot import this module,
 * so their inline literals MUST mirror these values exactly.  A dedicated test
 * (`tests/pwa-drift.test.ts`) parses both static files and asserts that every
 * constant matches — the test fails on any drift.
 *
 * Consumers should import from `@/lib/pwa` (or from this file directly) rather
 * than from the individual sub-modules to keep the dependency footprint
 * predictable.
 */

// ---------------------------------------------------------------------------
// Service-worker cache versioning
// ---------------------------------------------------------------------------

export {
  OFFLINE_PAYLOAD_VERSION,
  SW_CACHE_VERSION,
  SW_CACHE_PREFIX,
  SW_CACHE_NAME,
  /** SW messaging/sync constants */
  SYNC_TAG,
  FLUSH_MESSAGE,
  PURGE_CACHES_MESSAGE,
  contentHash,
  makeArticleVersion,
  isOfflineStale,
  staleCacheNames,
} from "@/lib/cache-version";

// ---------------------------------------------------------------------------
// IndexedDB constants
// ---------------------------------------------------------------------------

export {
  DB_NAME,
  DB_VERSION,
  STORE_ARTICLES,
  STORE_MUTATIONS,
} from "@/lib/offline/idb";

// ---------------------------------------------------------------------------
// Offline page paths (pre-cached by the service worker on install)
// ---------------------------------------------------------------------------

export { OFFLINE_PAGE, OFFLINE_READER_PAGE } from "@/lib/assets";

// ---------------------------------------------------------------------------
// Article expiry
// ---------------------------------------------------------------------------

/**
 * Offline article expiry in milliseconds (30 days).
 *
 * Mirrors the private `EXPIRY_MS` constant inside `@/lib/offline/article-store`
 * and the inline `EXPIRY_MS` in `public/offline-reader.html`. All three MUST
 * stay in sync; the drift test verifies the static HTML value matches this one.
 */
export const OFFLINE_ARTICLE_EXPIRY_MS: number = 30 * 24 * 60 * 60 * 1000;
