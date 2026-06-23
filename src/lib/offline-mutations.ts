/**
 * Offline mutation wiring (RW-042) — the browser glue between the reader's
 * client mutations and the pure sync engine in `offline-sync.ts`.
 *
 * Client-only. Responsibilities:
 *   - `submitMutation`: send a mutation immediately when online, else enqueue it
 *     in IndexedDB (carrying an idempotency key so a later re-sync can't double
 *     apply). Network failures / 5xx while online are also enqueued.
 *   - `flushOfflineQueue`: drain the queue via the pure `flushQueue` engine.
 *   - `registerOfflineSync`: flush on `online` + on a service-worker "flush"
 *     message (Background Sync), and expose a small sync-state pub/sub for the
 *     status indicator component.
 *   - `purgeOfflineUserData`: wipe offline data on sign-out / account deletion.
 */
"use client";

import {
  classifyStatus,
  flushQueue,
  type FlushDeps,
  type FlushResult,
  type QueuedMutation,
} from "@/lib/offline-sync";
import {
  enqueueMutation,
  listQueuedMutations,
  removeQueuedMutation,
  updateQueuedMutation,
  countQueuedMutations,
  clearQueuedMutations,
  purgeOfflineData,
} from "@/lib/offline-db";

/** Header carrying the idempotency key to the server on every send. */
export const MUTATION_HEADER = "x-client-mutation-id";

/** Service-worker Background Sync tag + message type used to trigger a flush. */
export const SYNC_TAG = "readwise-mutations";
const SW_FLUSH_MESSAGE = "readwise:flush-queue";

export interface MutationSpec {
  type: string;
  endpoint: string;
  method?: string;
  body?: unknown;
  /** Optional collapse key (see {@link enqueueMutation}). */
  dedupeKey?: string;
  /**
   * Optional caller-supplied idempotency key. When omitted a fresh one is
   * generated. Supply it when the SAME logical mutation may be attempted both
   * online (in the component) and then queued on failure, so a partially
   * applied online attempt and the queued retry share one key and can't double
   * apply (e.g. a quiz attempt).
   */
  clientMutationId?: string;
}

export interface SubmitResult {
  /** True when delivered synchronously (online + accepted). */
  sent: boolean;
  /** True when stored for later sync (offline / transient failure). */
  queued: boolean;
  status?: number;
}

// ---------------------------------------------------------------------------
// Sync-state pub/sub (for the indicator component)
// ---------------------------------------------------------------------------

export interface SyncState {
  pending: number;
  syncing: boolean;
  lastResult: FlushResult | null;
}

let state: SyncState = { pending: 0, syncing: false, lastResult: null };
const subscribers = new Set<(s: SyncState) => void>();

function emit() {
  for (const cb of subscribers) cb(state);
}

/** Subscribe to sync-state changes; immediately invokes `cb` with the current state. */
export function subscribeSyncState(cb: (s: SyncState) => void): () => void {
  subscribers.add(cb);
  cb(state);
  return () => {
    subscribers.delete(cb);
  };
}

export function getSyncState(): SyncState {
  return state;
}

async function refreshPending(): Promise<void> {
  state = { ...state, pending: await countQueuedMutations() };
  emit();
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function newMutationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

/** Public idempotency-key generator for callers that need to pre-mint one. */
export function newClientMutationId(): string {
  return newMutationId();
}

async function sendRequest(
  endpoint: string,
  method: string,
  payload: unknown,
  clientMutationId: string,
): Promise<{ status: number }> {
  const hasBody = method !== "GET" && method !== "DELETE" && payload != null;
  const res = await fetch(endpoint, {
    method,
    headers: {
      "Content-Type": "application/json",
      [MUTATION_HEADER]: clientMutationId,
    },
    body: hasBody ? JSON.stringify(payload) : undefined,
  });
  return { status: res.status };
}

/**
 * Submit a mutation. When online, attempts immediate delivery; a 2xx/409 is a
 * success, a hard client error (4xx) is reported back without queuing (it would
 * never succeed), and an offline state / network error / 5xx is queued for a
 * later flush — all under the SAME idempotency key so a duplicate cannot apply.
 */
export async function submitMutation(spec: MutationSpec): Promise<SubmitResult> {
  const clientMutationId = spec.clientMutationId ?? newMutationId();
  const method = spec.method ?? "POST";
  const payload = spec.body ?? null;

  if (isOnline()) {
    try {
      const { status } = await sendRequest(spec.endpoint, method, payload, clientMutationId);
      const outcome = classifyStatus(status);
      if (outcome === "success") return { sent: true, queued: false, status };
      if (outcome === "permanent") return { sent: false, queued: false, status };
      // Transient (5xx/429/408) — fall through to enqueue for retry.
    } catch {
      // Network error — fall through to enqueue.
    }
  }

  await enqueueMutation({
    clientMutationId,
    type: spec.type,
    endpoint: spec.endpoint,
    method,
    payload,
    dedupeKey: spec.dedupeKey ?? null,
  });
  await refreshPending();
  await requestBackgroundSync();
  return { sent: false, queued: true };
}

// ---------------------------------------------------------------------------
// Flushing
// ---------------------------------------------------------------------------

function flushDeps(): FlushDeps {
  return {
    list: () => listQueuedMutations(),
    send: (mutation: QueuedMutation) =>
      sendRequest(mutation.endpoint, mutation.method, mutation.payload, mutation.clientMutationId),
    remove: (id) => removeQueuedMutation(id),
    update: (id, patch) => updateQueuedMutation(id, patch),
  };
}

let flushing: Promise<FlushResult> | null = null;

/** Drain the offline queue. Concurrent calls share the in-flight pass. */
export async function flushOfflineQueue(): Promise<FlushResult> {
  if (flushing) return flushing;
  state = { ...state, syncing: true };
  emit();
  flushing = (async () => {
    try {
      const result = await flushQueue(flushDeps());
      state = { pending: result.remaining, syncing: false, lastResult: result };
      emit();
      return result;
    } catch {
      const fallback: FlushResult = {
        attempted: 0,
        succeeded: 0,
        retried: 0,
        failed: 0,
        remaining: await countQueuedMutations(),
      };
      state = { ...state, syncing: false };
      emit();
      return fallback;
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

async function requestBackgroundSync(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    };
    if (reg.sync) await reg.sync.register(SYNC_TAG);
  } catch {
    // Background Sync unsupported — the `online` listener still covers us.
  }
}

// ---------------------------------------------------------------------------
// Lifecycle registration
// ---------------------------------------------------------------------------

let registered = false;

/**
 * Wire up connectivity-driven syncing. Idempotent. Flushes:
 *   - on the window `online` event,
 *   - when the service worker posts the flush message (Background Sync),
 *   - once on registration if we're already online and have a backlog.
 */
export function registerOfflineSync(): void {
  if (registered || typeof window === "undefined") return;
  registered = true;

  window.addEventListener("online", () => {
    void flushOfflineQueue();
  });

  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
      if (event.data && event.data.type === SW_FLUSH_MESSAGE) {
        void flushOfflineQueue();
      }
    });
  }

  void refreshPending().then(() => {
    if (isOnline() && state.pending > 0) void flushOfflineQueue();
  });
}

// ---------------------------------------------------------------------------
// Privacy purge (RW-044)
// ---------------------------------------------------------------------------

/**
 * Wipe ALL offline data for the current device: queued mutations, the offline
 * article store, and the service-worker runtime caches. Call before signing out
 * or after account deletion so private content never lingers on a shared device.
 */
export async function purgeOfflineUserData(): Promise<void> {
  try {
    await clearQueuedMutations();
  } catch {
    // ignore
  }
  try {
    await purgeOfflineData();
  } catch {
    // ignore
  }
  // Ask the service worker to drop its runtime caches too.
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      reg.active?.postMessage({ type: "readwise:purge-caches" });
    } catch {
      // ignore
    }
  }
  state = { pending: 0, syncing: false, lastResult: null };
  emit();
}
