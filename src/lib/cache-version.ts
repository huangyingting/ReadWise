/**
 * Offline cache versioning (RW-044).
 *
 * Pure helpers shared by the server (offline article route), the client
 * (offline IndexedDB store + download button) and — by mirrored constant — the
 * service worker. No DOM / network / crypto-subtle so it is deterministic and
 * unit-testable, and safe to import from both server and client code.
 */

import { STORAGE_KEYS } from "./storage-keys";

/**
 * Format version of the stored offline article payload. Bump when the shape of
 * the cached record changes so old records are treated as stale and refreshed.
 */
export const OFFLINE_PAYLOAD_VERSION = 2;

/**
 * Service worker runtime cache version. MUST be kept in sync with the
 * `CACHE_VERSION` constant in `public/sw.js` (the SW can't import this module).
 * Bumping it makes the SW drop every older runtime cache on activate.
 */
export const SW_CACHE_VERSION = "v3";

/** The runtime cache name derived from {@link SW_CACHE_VERSION}. */
export const SW_CACHE_PREFIX = "readwise-";
export const SW_CACHE_NAME = `${SW_CACHE_PREFIX}${SW_CACHE_VERSION}`;

/**
 * Fast, dependency-free FNV-1a 32-bit hash rendered as 8 hex chars. Not
 * cryptographic — only a stable content fingerprint to detect changes. Stable
 * across server and client so versions computed in either place compare equal.
 */
export function contentHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in 32-bit range.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Build a compact, comparable version string for an article's offline payload:
 *   `<payloadVersion>:<updatedAt-epoch>:<contentHash>`
 * Any change to the payload format, the article's `updatedAt`, or its content
 * yields a different string.
 */
export function makeArticleVersion(input: {
  contentHash: string;
  updatedAt?: Date | string | number | null;
}): string {
  const updated =
    input.updatedAt == null ? 0 : new Date(input.updatedAt).getTime() || 0;
  return `${OFFLINE_PAYLOAD_VERSION}:${updated}:${input.contentHash}`;
}

/**
 * True when a stored offline version differs from the server's current version
 * (or when either is missing) — i.e. the cached copy should be refreshed.
 */
export function isOfflineStale(
  storedVersion: string | null | undefined,
  serverVersion: string | null | undefined,
): boolean {
  if (!storedVersion || !serverVersion) return true;
  return storedVersion !== serverVersion;
}

// ---------------------------------------------------------------------------
// Service-worker messaging constants
// ---------------------------------------------------------------------------

/**
 * Background Sync tag registered by the client and handled by the service
 * worker to trigger an offline mutation queue flush (RW-042).
 *
 * MUST stay in sync with `SYNC_TAG` in `public/sw.js`.
 */
export const SYNC_TAG = "readwise-mutations" as const;

/**
 * Message type posted to open clients by the SW (Background Sync) and also
 * listened for by the page to flush the offline mutation queue.
 *
 * MUST stay in sync with `FLUSH_MESSAGE` in `public/sw.js`.
 */
export const FLUSH_MESSAGE = STORAGE_KEYS.SW_FLUSH_QUEUE;

/**
 * Message type posted to the active service worker to drop all readwise-*
 * runtime caches on sign-out / account deletion (privacy purge).
 *
 * MUST stay in sync with the message handler in `public/sw.js`.
 */
export const PURGE_CACHES_MESSAGE = STORAGE_KEYS.SW_PURGE_CACHES;

/**
 * Given the existing cache names and the current cache name, return the names
 * that should be deleted (every readwise-* cache that isn't current). Foreign
 * caches (different prefix) are left untouched. Pure — mirrored by the SW's
 * `activate` cleanup so the logic can be tested here.
 */
export function staleCacheNames(
  existing: string[],
  currentName: string,
  prefix = SW_CACHE_PREFIX,
): string[] {
  return existing.filter((name) => name.startsWith(prefix) && name !== currentName);
}
