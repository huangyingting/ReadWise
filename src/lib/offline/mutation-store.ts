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

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((res, rej) => {
    request.onsuccess = () => res(request.result);
    request.onerror = () => rej(request.error);
  });
}

function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function deleteExistingDedupeMatches(
  store: IDBObjectStore,
  dedupeKey: string,
): Promise<void> {
  const idx = store.index("dedupeKey");
  await new Promise<void>((res, rej) => {
    const cursorReq = idx.openCursor(IDBKeyRange.only(dedupeKey));
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

function queuedMutationFromInput(input: EnqueueMutationInput): QueuedMutation {
  return {
    clientMutationId: input.clientMutationId,
    type: input.type,
    endpoint: input.endpoint,
    method: input.method,
    payload: input.payload,
    createdAt: new Date().toISOString(),
    purgeGeneration: input.purgeGeneration ?? null,
    actorId: input.actorId,
    queueRevision: 0,
    retryCount: 0,
    status: "pending",
    lastError: null,
    dedupeKey: input.dedupeKey ?? null,
    dependsOnClientMutationId: input.dependsOnClientMutationId ?? null,
    dependsOnClientMutationIds: input.dependsOnClientMutationIds ?? null,
  };
}

/** Input to {@link enqueueMutation} — timestamps/counters are filled in here. */
export interface EnqueueMutationInput {
  clientMutationId: string;
  type: string;
  endpoint: string;
  method: string;
  payload: unknown;
  /** Privacy generation captured before the mutation's first async operation. */
  purgeGeneration?: string | null;
  /** Authenticated account that originated the mutation. */
  actorId?: string;
  /** Optional collapse key — a new mutation replaces a pending one with the same key. */
  dedupeKey?: string | null;
  /** Mutation that must be delivered before this record may be sent. */
  dependsOnClientMutationId?: string | null;
  /** Mutations that must all be delivered before this record may be sent. */
  dependsOnClientMutationIds?: string[] | null;
}

/**
 * Append a mutation to the offline queue. When `dedupeKey` is supplied, any
 * existing queued mutation with the same key is removed first so only the
 * latest survives (e.g. the newest scroll progress / note edit). Returns true
 * only after the IndexedDB transaction commits.
 */
export async function enqueueMutation(
  input: EnqueueMutationInput,
): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_MUTATIONS, "readwrite");
    const store = tx.objectStore(STORE_MUTATIONS);

    if (input.dedupeKey) {
      await deleteExistingDedupeMatches(store, input.dedupeKey);
    }

    store.put(queuedMutationFromInput(input));
    await waitForTransaction(tx);
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** Replace the payload of an existing queued mutation after a committed write. */
export async function replaceQueuedMutationPayload(
  clientMutationId: string,
  payload: unknown,
): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_MUTATIONS, "readwrite");
    const store = tx.objectStore(STORE_MUTATIONS);
    const existing =
      ((await requestResult(store.get(clientMutationId))) as
        | QueuedMutation
        | undefined) ?? null;
    if (!existing) {
      db.close();
      return false;
    }
    store.put({
      ...existing,
      payload,
      queueRevision: (existing.queueRevision ?? 0) + 1,
    });
    await waitForTransaction(tx);
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** Remove a queued mutation, reporting whether an existing record was committed away. */
export async function discardQueuedMutation(
  clientMutationId: string,
): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_MUTATIONS, "readwrite");
    const store = tx.objectStore(STORE_MUTATIONS);
    const existing = await requestResult(store.get(clientMutationId));
    if (!existing) {
      db.close();
      return false;
    }
    store.delete(clientMutationId);
    await waitForTransaction(tx);
    db.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a queued mutation only when it is still the generation that was
 * inspected. A stale drain must never delete a newer record that reused the
 * same logical key after an account transition.
 */
export async function removeQueuedMutationForGeneration(
  clientMutationId: string,
  purgeGeneration: string | null | undefined,
  actorId: string | undefined,
  createdAt?: string,
  queueRevision?: number,
): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_MUTATIONS, "readwrite");
    const store = tx.objectStore(STORE_MUTATIONS);
    const existing =
      ((await requestResult(store.get(clientMutationId))) as
        | QueuedMutation
        | undefined) ?? null;
    if (
      !existing ||
      existing.purgeGeneration !== purgeGeneration ||
      existing.actorId !== actorId ||
      (createdAt !== undefined && existing.createdAt !== createdAt) ||
      (queueRevision !== undefined &&
        existing.queueRevision !== queueRevision)
    ) {
      db.close();
      return false;
    }
    store.delete(clientMutationId);
    await waitForTransaction(tx);
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** Return all queued mutations (unordered; callers sort via sortQueue). */
export async function listQueuedMutations(): Promise<QueuedMutation[]> {
  if (!isIndexedDbAvailable()) return [];
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_MUTATIONS, "readonly");
    const store = tx.objectStore(STORE_MUTATIONS);
    const all = ((await requestResult(store.getAll())) as QueuedMutation[]) ?? [];
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
    const count = await requestResult(store.count());
    db.close();
    return count;
  } catch {
    return 0;
  }
}

/** Whether every durable row can be safely adopted by the current account. */
export async function queuedMutationsBelongTo(
  actorId: string,
  purgeGeneration: string,
): Promise<boolean> {
  if (!isIndexedDbAvailable()) return true;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_MUTATIONS, "readonly");
    const records =
      ((await requestResult(
        tx.objectStore(STORE_MUTATIONS).getAll(),
      )) as QueuedMutation[]) ?? [];
    db.close();
    return records.every(
      (record) =>
        record.actorId === actorId &&
        record.purgeGeneration === purgeGeneration,
    );
  } catch {
    return false;
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
    const existing =
      ((await requestResult(store.get(clientMutationId))) as
        | QueuedMutation
        | undefined) ?? null;
    if (existing) {
      store.put({
        ...existing,
        ...patch,
        clientMutationId,
        queueRevision: (existing.queueRevision ?? 0) + 1,
      });
    }
    await waitForTransaction(tx);
    db.close();
  } catch {
    // Best-effort.
  }
}

/** Update a record only while it still belongs to the inspected owner fence. */
export async function updateQueuedMutationForGeneration(
  clientMutationId: string,
  purgeGeneration: string | null | undefined,
  actorId: string | undefined,
  createdAt: string,
  queueRevision: number | undefined,
  patch: Partial<QueuedMutation>,
): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_MUTATIONS, "readwrite");
    const store = tx.objectStore(STORE_MUTATIONS);
    const existing =
      ((await requestResult(store.get(clientMutationId))) as
        | QueuedMutation
        | undefined) ?? null;
    if (
      !existing ||
      existing.purgeGeneration !== purgeGeneration ||
      existing.actorId !== actorId ||
      existing.createdAt !== createdAt ||
      existing.queueRevision !== queueRevision
    ) {
      db.close();
      return false;
    }
    store.put({
      ...existing,
      ...patch,
      clientMutationId,
      queueRevision: (existing.queueRevision ?? 0) + 1,
    });
    await waitForTransaction(tx);
    db.close();
    return true;
  } catch {
    return false;
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
    await waitForTransaction(tx);
    db.close();
  } catch {
    // Best-effort.
  }
}

/** Clear every queued mutation and report whether privacy cleanup completed. */
export async function clearQueuedMutations(): Promise<boolean> {
  if (!isIndexedDbAvailable()) return true;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_MUTATIONS, "readwrite");
    tx.objectStore(STORE_MUTATIONS).clear();
    await waitForTransaction(tx);
    db.close();
    return true;
  } catch {
    return false;
  }
}
