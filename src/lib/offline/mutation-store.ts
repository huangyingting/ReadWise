/**
 * Offline mutation queue persistence (RW-042).
 *
 * CRUD for the "mutations" IndexedDB object store: enqueue, list, update,
 * remove, and clear queued mutations waiting for delivery when connectivity
 * returns. Idempotency and deduplication semantics are preserved here:
 *
 *   - Each record is keyed by `clientMutationId` (the idempotency key).
 *   - `dedupeKey` allows latest-wins collapse (e.g. scroll progress, note edits)
 *     so only the most recent value for a given key is ever sent.
 *
 * Client-only: never imported by server code.
 */

import type { QueuedMutation } from "@/lib/offline-sync";
import { isIndexedDbAvailable, openDb, STORE_MUTATIONS } from "./idb";

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
export async function enqueueMutation(
  input: EnqueueMutationInput,
): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_MUTATIONS, "readwrite");
    const store = tx.objectStore(STORE_MUTATIONS);

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
    const tx = db.transaction(STORE_MUTATIONS, "readonly");
    const store = tx.objectStore(STORE_MUTATIONS);
    const all = await new Promise<QueuedMutation[]>((res, rej) => {
      const reqAll = store.getAll();
      reqAll.onsuccess = () =>
        res((reqAll.result as QueuedMutation[]) ?? []);
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
    const tx = db.transaction(STORE_MUTATIONS, "readonly");
    const store = tx.objectStore(STORE_MUTATIONS);
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
    const tx = db.transaction(STORE_MUTATIONS, "readwrite");
    const store = tx.objectStore(STORE_MUTATIONS);
    const existing = await new Promise<QueuedMutation | null>((res, rej) => {
      const getReq = store.get(clientMutationId);
      getReq.onsuccess = () =>
        res((getReq.result as QueuedMutation) ?? null);
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
export async function removeQueuedMutation(
  clientMutationId: string,
): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_MUTATIONS, "readwrite");
    tx.objectStore(STORE_MUTATIONS).delete(clientMutationId);
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
    const tx = db.transaction(STORE_MUTATIONS, "readwrite");
    tx.objectStore(STORE_MUTATIONS).clear();
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {
    // Best-effort.
  }
}
