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

/** Returned by store work that decided not to write (nothing to commit). */
const NO_WRITE = Symbol("no-write");

/**
 * Runs `work` in one transaction on the mutations store and closes the
 * database. Read-write work resolves only after the transaction commits.
 * Resolves `fallback` when IndexedDB is unavailable, anything fails, or the
 * work returned {@link NO_WRITE}.
 */
async function withMutationStore<T>(
  mode: IDBTransactionMode,
  fallback: T,
  work: (store: IDBObjectStore) => Promise<T | typeof NO_WRITE>,
): Promise<T> {
  if (!isIndexedDbAvailable()) return fallback;
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE_MUTATIONS, mode);
      // Listen before any request runs so the commit can't be missed; the
      // no-op catch only marks it handled for paths that never await it.
      const committed = mode === "readwrite" ? waitForTransaction(tx) : null;
      committed?.catch(() => {});
      const result = await work(tx.objectStore(STORE_MUTATIONS));
      if (result === NO_WRITE) return fallback;
      await committed;
      return result;
    } finally {
      db.close();
    }
  } catch {
    return fallback;
  }
}

async function readQueuedMutation(
  store: IDBObjectStore,
  clientMutationId: string,
): Promise<QueuedMutation | null> {
  return ((await requestResult(store.get(clientMutationId))) as QueuedMutation | undefined) ?? null;
}

/**
 * Reads one record and, when it exists and `accept` approves it, applies
 * `write`. Resolves true only after that write commits.
 */
function rewriteQueuedMutation(
  clientMutationId: string,
  accept: (existing: QueuedMutation) => boolean,
  write: (store: IDBObjectStore, existing: QueuedMutation) => void,
): Promise<boolean> {
  return withMutationStore("readwrite", false, async (store) => {
    const existing = await readQueuedMutation(store, clientMutationId);
    if (!existing || !accept(existing)) return NO_WRITE;
    write(store, existing);
    return true;
  });
}

/** Stores `existing` with `patch` applied and its queue revision bumped. */
function putPatched(store: IDBObjectStore, existing: QueuedMutation, patch: Partial<QueuedMutation>): void {
  store.put({
    ...existing,
    ...patch,
    clientMutationId: existing.clientMutationId,
    queueRevision: (existing.queueRevision ?? 0) + 1,
  });
}

const always = () => true;

/**
 * Append a mutation to the offline queue. When `dedupeKey` is supplied, any
 * existing queued mutation with the same key is removed first so only the
 * latest survives (e.g. the newest scroll progress / note edit). Returns true
 * only after the IndexedDB transaction commits.
 */
export function enqueueMutation(input: EnqueueMutationInput): Promise<boolean> {
  return withMutationStore("readwrite", false, async (store) => {
    if (input.dedupeKey) {
      await deleteExistingDedupeMatches(store, input.dedupeKey);
    }
    store.put(queuedMutationFromInput(input));
    return true;
  });
}

/** Replace the payload of an existing queued mutation after a committed write. */
export function replaceQueuedMutationPayload(
  clientMutationId: string,
  payload: unknown,
): Promise<boolean> {
  return rewriteQueuedMutation(clientMutationId, always, (store, existing) =>
    putPatched(store, existing, { payload }),
  );
}

/** Remove a queued mutation, reporting whether an existing record was committed away. */
export function discardQueuedMutation(clientMutationId: string): Promise<boolean> {
  return rewriteQueuedMutation(clientMutationId, always, (store) => store.delete(clientMutationId));
}

/**
 * Remove a queued mutation only when it is still the generation that was
 * inspected. A stale drain must never delete a newer record that reused the
 * same logical key after an account transition.
 */
export function removeQueuedMutationForGeneration(
  clientMutationId: string,
  purgeGeneration: string | null | undefined,
  actorId: string | undefined,
  createdAt?: string,
  queueRevision?: number,
): Promise<boolean> {
  return rewriteQueuedMutation(
    clientMutationId,
    (existing) =>
      existing.purgeGeneration === purgeGeneration &&
      existing.actorId === actorId &&
      (createdAt === undefined || existing.createdAt === createdAt) &&
      (queueRevision === undefined || existing.queueRevision === queueRevision),
    (store) => store.delete(clientMutationId),
  );
}

/** Return all queued mutations (unordered; callers sort via sortQueue). */
export function listQueuedMutations(): Promise<QueuedMutation[]> {
  return withMutationStore(
    "readonly",
    [],
    async (store) => ((await requestResult(store.getAll())) as QueuedMutation[]) ?? [],
  );
}

/** Number of mutations currently queued (includes failed). */
export function countQueuedMutations(): Promise<number> {
  return withMutationStore("readonly", 0, (store) => requestResult(store.count()));
}

/** Whether every durable row can be safely adopted by the current account. */
export async function queuedMutationsBelongTo(
  actorId: string,
  purgeGeneration: string,
): Promise<boolean> {
  if (!isIndexedDbAvailable()) return true;
  return withMutationStore("readonly", false, async (store) => {
    const records = ((await requestResult(store.getAll())) as QueuedMutation[]) ?? [];
    return records.every(
      (record) => record.actorId === actorId && record.purgeGeneration === purgeGeneration,
    );
  });
}

/** Apply a partial patch to a queued mutation (status / retryCount / lastError). Best-effort. */
export async function updateQueuedMutation(
  clientMutationId: string,
  patch: Partial<QueuedMutation>,
): Promise<void> {
  await rewriteQueuedMutation(clientMutationId, always, (store, existing) =>
    putPatched(store, existing, patch),
  );
}

/** Update a record only while it still belongs to the inspected owner fence. */
export function updateQueuedMutationForGeneration(
  clientMutationId: string,
  purgeGeneration: string | null | undefined,
  actorId: string | undefined,
  createdAt: string,
  queueRevision: number | undefined,
  patch: Partial<QueuedMutation>,
): Promise<boolean> {
  return rewriteQueuedMutation(
    clientMutationId,
    (existing) =>
      existing.purgeGeneration === purgeGeneration &&
      existing.actorId === actorId &&
      existing.createdAt === createdAt &&
      existing.queueRevision === queueRevision,
    (store, existing) => putPatched(store, existing, patch),
  );
}

/** Remove a delivered (or discarded) mutation from the queue. Best-effort. */
export async function removeQueuedMutation(clientMutationId: string): Promise<void> {
  await withMutationStore("readwrite", undefined, async (store) => {
    store.delete(clientMutationId);
  });
}

/** Clear every queued mutation and report whether privacy cleanup completed. */
export async function clearQueuedMutations(): Promise<boolean> {
  if (!isIndexedDbAvailable()) return true;
  return withMutationStore("readwrite", false, async (store) => {
    store.clear();
    return true;
  });
}
