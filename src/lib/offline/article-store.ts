/**
 * Offline article cache (RW-042, RW-044).
 *
 * CRUD for the "articles" IndexedDB object store: save, retrieve, list, and
 * remove articles the user downloaded for offline reading. Also handles:
 *   - LRU eviction when the cap is reached.
 *   - 30-day expiry to prevent stale private content lingering on device.
 *   - Privacy purge (wipes the entire database on sign-out/account deletion).
 *
 * Client-only: never imported by server code.
 */

import { isIndexedDbAvailable, openDb, STORE_ARTICLES, DB_NAME } from "./idb";

/** Maximum number of articles stored offline (storage quota guard). */
export const MAX_OFFLINE_ARTICLES = 50;

/** Article expiry in milliseconds (30 days). */
const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

type ArticleStoreHandle = {
  db: IDBDatabase;
  tx: IDBTransaction;
  store: IDBObjectStore;
};

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

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function openArticleStore(mode: IDBTransactionMode): Promise<ArticleStoreHandle> {
  const db = await openDb();
  const tx = db.transaction(STORE_ARTICLES, mode);
  return { db, tx, store: tx.objectStore(STORE_ARTICLES) };
}

function offlineArticleRecord(
  article: Omit<OfflineArticle, "savedAt">,
): OfflineArticle {
  return {
    ...article,
    savedAt: new Date().toISOString(),
  };
}

function isExpired(savedAt: string, now = Date.now()): boolean {
  return now - new Date(savedAt).getTime() > EXPIRY_MS;
}

function sortNewestFirst(a: OfflineArticle, b: OfflineArticle): number {
  return new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime();
}

async function evictOldestIfAtCap(store: IDBObjectStore): Promise<void> {
  const count = await requestResult(store.count());
  if (count < MAX_OFFLINE_ARTICLES) return;

  const cursor = await requestResult(store.index("savedAt").openCursor());
  if (cursor) cursor.delete();
}

/** Stores an article for offline reading. Evicts the oldest if cap is reached. */
export async function saveOfflineArticle(
  article: Omit<OfflineArticle, "savedAt">,
): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  let db: IDBDatabase | null = null;
  try {
    const handle = await openArticleStore("readwrite");
    db = handle.db;
    await evictOldestIfAtCap(handle.store);
    handle.store.put(offlineArticleRecord(article));
    await transactionComplete(handle.tx);
  } catch {
    // Silently fail — offline storage is best-effort.
  } finally {
    db?.close();
  }
}

/** Retrieves a single article from offline storage by id, or null if absent. */
export async function getOfflineArticle(
  id: string,
): Promise<OfflineArticle | null> {
  if (!isIndexedDbAvailable()) return null;
  let db: IDBDatabase | null = null;
  try {
    const handle = await openArticleStore("readonly");
    db = handle.db;
    const result = ((await requestResult(handle.store.get(id))) as
      | OfflineArticle
      | undefined) ?? null;
    if (!result) return null;
    // Expire articles older than EXPIRY_MS.
    if (isExpired(result.savedAt)) {
      void removeOfflineArticle(id);
      return null;
    }
    return result;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/** Returns all offline articles sorted newest-first. */
export async function getAllOfflineArticles(): Promise<OfflineArticle[]> {
  if (!isIndexedDbAvailable()) return [];
  let db: IDBDatabase | null = null;
  try {
    const handle = await openArticleStore("readonly");
    db = handle.db;
    const all = ((await requestResult(handle.store.getAll())) as
      | OfflineArticle[]
      | undefined) ?? [];
    // Filter expired, sort newest-first.
    const now = Date.now();
    return all
      .filter((article) => !isExpired(article.savedAt, now))
      .sort(sortNewestFirst);
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

/** Removes a single article from offline storage. */
export async function removeOfflineArticle(id: string): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  let db: IDBDatabase | null = null;
  try {
    const handle = await openArticleStore("readwrite");
    db = handle.db;
    handle.store.delete(id);
    await transactionComplete(handle.tx);
  } catch {
    // Silently fail.
  } finally {
    db?.close();
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
// Privacy purge (RW-044)
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
