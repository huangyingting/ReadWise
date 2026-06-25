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

/** Stores an article for offline reading. Evicts the oldest if cap is reached. */
export async function saveOfflineArticle(
  article: Omit<OfflineArticle, "savedAt">,
): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_ARTICLES, "readwrite");
    const store = tx.objectStore(STORE_ARTICLES);

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
    const tx = db.transaction(STORE_ARTICLES, "readonly");
    const store = tx.objectStore(STORE_ARTICLES);
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
    const tx = db.transaction(STORE_ARTICLES, "readonly");
    const store = tx.objectStore(STORE_ARTICLES);
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
    const tx = db.transaction(STORE_ARTICLES, "readwrite");
    tx.objectStore(STORE_ARTICLES).delete(id);
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
