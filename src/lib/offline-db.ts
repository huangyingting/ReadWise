/**
 * Client-side IndexedDB storage for offline article reading (#117).
 *
 * Stores a lightweight article payload (sanitized HTML, metadata) that the
 * user explicitly downloaded. No user-specific data (progress, notes, saves)
 * is stored — only the article content the user can already see in the reader.
 *
 * Design constraints:
 *  - Client-only: never imported by server code.
 *  - Graceful degradation: all functions return safe values when IndexedDB is
 *    unavailable (private browsing restrictions, etc.).
 *  - Cap: maximum MAX_OFFLINE_ARTICLES stored; oldest is evicted on overflow.
 */

const DB_NAME = "readwise-offline";
const DB_VERSION = 1;
const STORE_NAME = "articles";

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
