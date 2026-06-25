/**
 * IndexedDB open/upgrade helpers for the ReadWise offline package (RW-042).
 *
 * Client-only internal module. All other offline modules open the database
 * through here so versioned schema migrations live in exactly one place.
 *
 * Object stores:
 *   - STORE_ARTICLES:  lightweight article payloads saved for offline reading.
 *   - STORE_MUTATIONS: durable offline mutations awaiting sync (RW-042).
 *
 * Design constraints:
 *   - Client-only: never imported by server code.
 *   - Graceful degradation: {@link isIndexedDbAvailable} guards every caller;
 *     all public functions return safe defaults when IndexedDB is unavailable.
 */

export const DB_NAME = "readwise-offline";
export const DB_VERSION = 2;
export const STORE_ARTICLES = "articles";
export const STORE_MUTATIONS = "mutations";

/** True when IndexedDB is accessible (false in SSR and some private-browsing modes). */
export function isIndexedDbAvailable(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

/**
 * Open (and upgrade if necessary) the ReadWise offline database.
 * Resolves to an open {@link IDBDatabase}; rejects on hard error.
 */
export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_ARTICLES)) {
        const store = db.createObjectStore(STORE_ARTICLES, { keyPath: "id" });
        // Index by savedAt for LRU eviction.
        store.createIndex("savedAt", "savedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_MUTATIONS)) {
        const mutations = db.createObjectStore(STORE_MUTATIONS, {
          keyPath: "clientMutationId",
        });
        // Index by createdAt (FIFO delivery) and dedupeKey (latest-wins collapse).
        mutations.createIndex("createdAt", "createdAt", { unique: false });
        mutations.createIndex("dedupeKey", "dedupeKey", { unique: false });
      }
    };

    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}
