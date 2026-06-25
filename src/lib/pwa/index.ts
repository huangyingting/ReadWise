/**
 * PWA/offline runtime package (REF-056).
 *
 * Exports every constant and pure helper that governs the PWA offline runtime:
 * service-worker cache versioning, IndexedDB schema identifiers, sync
 * tag/message names, article expiry, and offline page paths.
 *
 * Sub-modules:
 *   - `@/lib/pwa/constants` — all constants (usable in server + client code)
 *
 * Related static files (cannot import this module; verified by test):
 *   - `public/sw.js`              — mirrors SW_CACHE_VERSION, SYNC_TAG, FLUSH_MESSAGE
 *   - `public/offline-reader.html`— mirrors DB_NAME, DB_VERSION, STORE_ARTICLES, EXPIRY_MS
 */

export * from "./constants";
