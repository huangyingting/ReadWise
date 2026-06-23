/**
 * Client-side IndexedDB storage for offline article reading (#117) and the
 * offline mutation queue (RW-042).
 *
 * Two object stores:
 *  - "articles":  a lightweight, user-agnostic article payload the user
 *                 explicitly downloaded (sanitized HTML + metadata + a content
 *                 version for cache invalidation — RW-044).
 *  - "mutations": durable offline mutations (progress / notes / saved words /
 *                 quiz attempts) awaiting sync when connectivity returns.
 *
 * Design constraints:
 *  - Client-only: never imported by server code.
 *  - Graceful degradation: all functions return safe values when IndexedDB is
 *    unavailable (private browsing restrictions, etc.).
 *  - Cap: maximum MAX_OFFLINE_ARTICLES stored; oldest is evicted on overflow.
 */

import type { QueuedMutation } from "@/lib/offline-sync";

const DB_NAME = "readwise-offline";
const DB_VERSION = 2;
const STORE_NAME = "articles";
const MUTATIONS_STORE = "mutations";

/** Maximum number of articles stored offline (storage quota guard). */
export const MAX_OFFLINE_ARTICLES = 50;

/** Article expiry in milliseconds (30 days). */
const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export interface OfflineArticle {
  /** Primary key — article ID. */
  id: string;
  title: string;
  sanitizedHtml: string;
  author: string | null;
  source: string | null;
  sourceUrl: string | null;
  heroImage: string | null;
  difficulty: string | null;
  readingMinutes: number | null;
  publishedAt: string | null;
  /**
   * Content version for cache invalidation (RW-044). Compared against the
   * server's current version to detect a stale offline copy. Optional so
   * records written before versioning still load.
   */
  version?: string | null;
  /** Fingerprint of the sanitized HTML (component of {@link version}). */
  contentHash?: string | null;
  /** ISO timestamp when the user downloaded this article. */
  savedAt: string;
}

// ---------------------------------------------------------------------------
// Internal DB helpers
// ---------------------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        // Index by savedAt for LRU eviction.
        store.createIndex("savedAt", "savedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(MUTATIONS_STORE)) {
        const mutations = db.createObjectStore(MUTATIONS_STORE, {
          keyPath: "clientMutationId",
        });
        // Index by createdAt (FIFO) and dedupeKey (collapse latest-wins).
        mutations.createIndex("createdAt", "createdAt", { unique: false });
        mutations.createIndex("dedupeKey", "dedupeKey", { unique: false });
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

function isIndexedDbAvailable(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Stores an article for offline reading. Evicts the oldest if cap is reached. */
export async function saveOfflineArticle(
  article: Omit<OfflineArticle, "savedAt">,
): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    // Evict oldest if at cap.
    const countReq = store.count();
    await new Promise<void>((res, rej) => {
      countReq.onsuccess = async () => {
        const count = countReq.result;
        if (count >= MAX_OFFLINE_ARTICLES) {
          // Remove by oldest savedAt via index cursor.
          const idx = store.index("savedAt");
          const cursorReq = idx.openCursor();
          cursorReq.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor) cursor.delete();
            res();
          };
          cursorReq.onerror = () => rej(cursorReq.error);
        } else {
          res();
        }
      };
      countReq.onerror = () => rej(countReq.error);
    });

    const record: OfflineArticle = {
      ...article,
      savedAt: new Date().toISOString(),
    };
    store.put(record);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {
    // Silently fail — offline storage is best-effort.
  }
}

/** Retrieves a single article from offline storage by id, or null if absent. */
export async function getOfflineArticle(
  id: string,
): Promise<OfflineArticle | null> {
  if (!isIndexedDbAvailable()) return null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const result = await new Promise<OfflineArticle | null>((res, rej) => {
      const req = store.get(id);
      req.onsuccess = () => res((req.result as OfflineArticle) ?? null);
      req.onerror = () => rej(req.error);
    });
    db.close();
    if (!result) return null;
    // Expire articles older than EXPIRY_MS.
    const age = Date.now() - new Date(result.savedAt).getTime();
    if (age > EXPIRY_MS) {
      void removeOfflineArticle(id);
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

/** Returns all offline articles sorted newest-first. */
export async function getAllOfflineArticles(): Promise<OfflineArticle[]> {
  if (!isIndexedDbAvailable()) return [];
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const all = await new Promise<OfflineArticle[]>((res, rej) => {
      const req = store.getAll();
      req.onsuccess = () => res((req.result as OfflineArticle[]) ?? []);
      req.onerror = () => rej(req.error);
    });
    db.close();
    // Filter expired, sort newest-first.
    const now = Date.now();
    return all
      .filter((a) => now - new Date(a.savedAt).getTime() <= EXPIRY_MS)
      .sort(
        (a, b) =>
          new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
      );
  } catch {
    return [];
  }
}

/** Removes a single article from offline storage. */
export async function removeOfflineArticle(id: string): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {
    // Silently fail.
  }
}

/** Returns true if an article is currently stored for offline reading. */
export async function isArticleOffline(id: string): Promise<boolean> {
  const article = await getOfflineArticle(id);
  return article !== null;
}

/** Returns the stored content version for an offline article, or null. */
export async function getOfflineArticleVersion(
  id: string,
): Promise<string | null> {
  const article = await getOfflineArticle(id);
  return article?.version ?? null;
}

// ---------------------------------------------------------------------------
// Offline mutation queue (RW-042)
// ---------------------------------------------------------------------------

/** Input to {@link enqueueMutation} — timestamps/counters are filled in here. */
export interface EnqueueMutationInput {
  clientMutationId: string;
  type: string;
  endpoint: string;
  method: string;
  payload: unknown;
  /** Optional collapse key — a new mutation replaces a pending one with the same key. */
  dedupeKey?: string | null;
}

/**
 * Append a mutation to the offline queue. When `dedupeKey` is supplied, any
 * existing queued mutation with the same key is removed first so only the
 * latest survives (e.g. the newest scroll progress / note edit). Best-effort:
 * silently no-ops when IndexedDB is unavailable.
 */
export async function enqueueMutation(input: EnqueueMutationInput): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(MUTATIONS_STORE, "readwrite");
    const store = tx.objectStore(MUTATIONS_STORE);

    if (input.dedupeKey) {
      const idx = store.index("dedupeKey");
      await new Promise<void>((res, rej) => {
        const cursorReq = idx.openCursor(IDBKeyRange.only(input.dedupeKey));
        cursorReq.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            res();
          }
        };
        cursorReq.onerror = () => rej(cursorReq.error);
      });
    }

    const record: QueuedMutation = {
      clientMutationId: input.clientMutationId,
      type: input.type,
      endpoint: input.endpoint,
      method: input.method,
      payload: input.payload,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      status: "pending",
      lastError: null,
      dedupeKey: input.dedupeKey ?? null,
    };
    store.put(record);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {
    // Best-effort — losing an offline enqueue must never crash the reader.
  }
}

/** Return all queued mutations (unordered; callers sort via sortQueue). */
export async function listQueuedMutations(): Promise<QueuedMutation[]> {
  if (!isIndexedDbAvailable()) return [];
  try {
    const db = await openDb();
    const tx = db.transaction(MUTATIONS_STORE, "readonly");
    const store = tx.objectStore(MUTATIONS_STORE);
    const all = await new Promise<QueuedMutation[]>((res, rej) => {
      const reqAll = store.getAll();
      reqAll.onsuccess = () => res((reqAll.result as QueuedMutation[]) ?? []);
      reqAll.onerror = () => rej(reqAll.error);
    });
    db.close();
    return all;
  } catch {
    return [];
  }
}

/** Number of mutations currently queued (includes failed). */
export async function countQueuedMutations(): Promise<number> {
  if (!isIndexedDbAvailable()) return 0;
  try {
    const db = await openDb();
    const tx = db.transaction(MUTATIONS_STORE, "readonly");
    const store = tx.objectStore(MUTATIONS_STORE);
    const count = await new Promise<number>((res, rej) => {
      const reqCount = store.count();
      reqCount.onsuccess = () => res(reqCount.result);
      reqCount.onerror = () => rej(reqCount.error);
    });
    db.close();
    return count;
  } catch {
    return 0;
  }
}

/** Apply a partial patch to a queued mutation (status / retryCount / lastError). */
export async function updateQueuedMutation(
  clientMutationId: string,
  patch: Partial<QueuedMutation>,
): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(MUTATIONS_STORE, "readwrite");
    const store = tx.objectStore(MUTATIONS_STORE);
    const existing = await new Promise<QueuedMutation | null>((res, rej) => {
      const getReq = store.get(clientMutationId);
      getReq.onsuccess = () => res((getReq.result as QueuedMutation) ?? null);
      getReq.onerror = () => rej(getReq.error);
    });
    if (existing) {
      store.put({ ...existing, ...patch, clientMutationId });
    }
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {
    // Best-effort.
  }
}

/** Remove a delivered (or discarded) mutation from the queue. */
export async function removeQueuedMutation(clientMutationId: string): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(MUTATIONS_STORE, "readwrite");
    tx.objectStore(MUTATIONS_STORE).delete(clientMutationId);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {
    // Best-effort.
  }
}

/** Clear every queued mutation (used by the sign-out / account purge). */
export async function clearQueuedMutations(): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(MUTATIONS_STORE, "readwrite");
    tx.objectStore(MUTATIONS_STORE).clear();
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {
    // Best-effort.
  }
}

// ---------------------------------------------------------------------------
// Privacy purge (RW-044) — drop ALL offline data on sign-out / account deletion
// ---------------------------------------------------------------------------

/**
 * Delete the entire offline database (articles + queued mutations). Called when
 * a user signs out or deletes their account so private/offline content is never
 * retained on a shared device. Best-effort and resolves even if blocked.
 */
export async function purgeOfflineData(): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      // `blocked` fires when another tab holds the DB open; resolve anyway.
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
