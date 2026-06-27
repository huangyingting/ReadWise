"use client";
/**
 * Offline sync runtime (RW-042) — browser glue between the reader's mutations
 * and the pure sync engine in `offline-sync.ts`.
 *
 * Client-only. Responsibilities:
 *   - `submitMutation`: send a mutation immediately when online, else enqueue it
 *     in IndexedDB carrying an idempotency key so a later re-sync can't double
 *     apply. Network failures / 5xx while online are also enqueued.
 *   - `flushOfflineQueue`: drain the queue via the pure `flushQueue` engine.
 *   - `registerOfflineSync`: flush on `online` + on a service-worker "flush"
 *     message (Background Sync), and expose a small sync-state pub/sub for the
 *     status indicator component.
 *   - `purgeOfflineUserData`: wipe offline data on sign-out / account deletion.
 */

import {
  classifyStatus,
  flushQueue,
  sortQueue,
  isConflict,
  isPermanentlyFailed,
  MAX_MUTATION_RETRIES,
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
} from "./mutation-store";
import {
  isTodayMutationType,
  isAllowedTodayPayload,
  isValidLocalDate,
  isValidTimezoneString,
} from "./registry";
import { purgeOfflineData } from "./article-store";
import { STORAGE_KEYS } from "@/lib/storage-keys";

/** Header carrying the idempotency key to the server on every send. */
export const MUTATION_HEADER = "x-client-mutation-id";

/** Service-worker Background Sync tag + message type used to trigger a flush. */
export const SYNC_TAG = "readwise-mutations";
const SW_FLUSH_MESSAGE = STORAGE_KEYS.SW_FLUSH_QUEUE;

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
// Today offline conflict pub/sub (#811)
// ---------------------------------------------------------------------------

/** Analytics + UI event name for a Today offline-replay conflict. */
export const TODAY_OFFLINE_CONFLICT_EVENT = "today_offline_conflict";

/**
 * Content-free description of a Today offline conflict: the mutation TYPE and
 * the HTTP STATUS only — never any payload content. Used both for the
 * non-blocking conflict toast and the `today_offline_conflict` analytics event.
 */
export interface TodayConflictInfo {
  mutationType: string;
  statusCode: number;
}

const conflictSubscribers = new Set<(info: TodayConflictInfo) => void>();

/**
 * Subscribe to Today offline conflicts (e.g. an offline skip the server already
 * resolved on another device). The Today UI uses this to show a non-blocking
 * "your progress is safe" notice. Returns an unsubscribe function.
 */
export function subscribeTodayConflicts(
  cb: (info: TodayConflictInfo) => void,
): () => void {
  conflictSubscribers.add(cb);
  return () => {
    conflictSubscribers.delete(cb);
  };
}

/** Notify subscribers of a Today conflict (ids/status only). */
function notifyTodayConflict(info: TodayConflictInfo): void {
  for (const cb of conflictSubscribers) cb(info);
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
export async function submitMutation(
  spec: MutationSpec,
): Promise<SubmitResult> {
  const clientMutationId = spec.clientMutationId ?? newMutationId();
  const method = spec.method ?? "POST";
  const payload = spec.body ?? null;

  if (isOnline()) {
    try {
      const { status } = await sendRequest(
        spec.endpoint,
        method,
        payload,
        clientMutationId,
      );
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
// Today offline mutation replay (#811)
// ---------------------------------------------------------------------------

/** Injected dependencies for {@link todayMutationReplayHandler} (testable in Node). */
export interface TodayReplayDeps {
  send: (mutation: QueuedMutation) => Promise<{ status: number }>;
  remove: (clientMutationId: string) => Promise<void>;
  update: (
    clientMutationId: string,
    patch: Partial<QueuedMutation>,
  ) => Promise<void>;
  /** Emits the content-free `today_offline_conflict` event on a 409. */
  onConflict?: (info: TodayConflictInfo) => void;
  maxRetries?: number;
}

export type TodayReplayOutcome =
  | "removed"
  | "conflict"
  | "retry"
  | "failed"
  | "invalid";

/**
 * Replay a single queued Today mutation against its Today API route, applying
 * Today-specific conflict semantics (unlike the generic engine, a `409` here is
 * a genuine conflict, not a resolved no-op):
 *
 *   1. Validate `localDate`/`timezone` and that the payload carries ONLY allowed
 *      fields — a malformed/content-bearing payload is marked `failed`, never sent.
 *   2. `2xx` → delivered (incl. idempotent no-ops): remove from the queue.
 *   3. `409` → conflict: mark the mutation `conflict` and emit the content-free
 *      `today_offline_conflict` event (ids + status only) for the toast/analytics.
 *   4. Network error / `5xx` / `408` / `429` → increment `retryCount` (existing
 *      exponential back-off); flag `failed` once retries are exhausted.
 *   5. Other `4xx` → permanent `failed`.
 *
 * All I/O is injected so the policy is unit-testable in plain Node.
 */
export async function todayMutationReplayHandler(
  mutation: QueuedMutation,
  deps: TodayReplayDeps,
): Promise<TodayReplayOutcome> {
  const maxRetries = deps.maxRetries ?? MAX_MUTATION_RETRIES;
  const payload = mutation.payload;
  const rec = (payload ?? {}) as Record<string, unknown>;

  // 1. Privacy + shape validation. Never send (or keep retrying) a payload that
  //    is malformed or carries fields outside the allowed Today set.
  if (
    !isTodayMutationType(mutation.type) ||
    !isAllowedTodayPayload(payload) ||
    !isValidLocalDate(rec.localDate) ||
    (rec.timezone !== undefined && !isValidTimezoneString(rec.timezone))
  ) {
    await deps.update(mutation.clientMutationId, {
      status: "failed",
      lastError: "invalid Today mutation payload",
    });
    return "invalid";
  }

  // 2. Deliver.
  let status: number;
  try {
    ({ status } = await deps.send(mutation));
  } catch (err) {
    return retryOrFail(
      mutation,
      deps,
      maxRetries,
      err instanceof Error ? err.message : String(err),
    );
  }

  // 3. Success (incl. idempotent no-op) — drop from the queue.
  if (status >= 200 && status < 300) {
    await deps.remove(mutation.clientMutationId);
    return "removed";
  }

  // 4. Conflict — the server already resolved this elsewhere. Non-destructive.
  if (status === 409) {
    await deps.update(mutation.clientMutationId, {
      status: "conflict",
      lastError: `HTTP ${status}`,
    });
    deps.onConflict?.({ mutationType: mutation.type, statusCode: status });
    return "conflict";
  }

  // 5. Transient — retry with back-off.
  if (status === 408 || status === 429 || status >= 500) {
    return retryOrFail(mutation, deps, maxRetries, `HTTP ${status}`);
  }

  // 6. Other 4xx — permanent failure.
  await deps.update(mutation.clientMutationId, {
    status: "failed",
    retryCount: mutation.retryCount + 1,
    lastError: `HTTP ${status}`,
  });
  return "failed";
}

/** Bump retryCount (back-off), or flag `failed` once retries are exhausted. */
async function retryOrFail(
  mutation: QueuedMutation,
  deps: TodayReplayDeps,
  maxRetries: number,
  errorMessage: string,
): Promise<TodayReplayOutcome> {
  const nextRetry = mutation.retryCount + 1;
  if (nextRetry >= maxRetries) {
    await deps.update(mutation.clientMutationId, {
      status: "failed",
      retryCount: nextRetry,
      lastError: errorMessage,
    });
    return "failed";
  }
  await deps.update(mutation.clientMutationId, {
    status: "pending",
    retryCount: nextRetry,
    lastError: errorMessage,
  });
  return "retry";
}

// ---------------------------------------------------------------------------
// Flushing
// ---------------------------------------------------------------------------

function flushDeps(): FlushDeps {
  return {
    // The generic engine handles every NON-Today mutation; Today mutations are
    // drained separately by `replayTodayMutations` so a 409 becomes a conflict
    // (not a resolved no-op as `classifyStatus` would otherwise treat it).
    list: async () =>
      (await listQueuedMutations()).filter((m) => !isTodayMutationType(m.type)),
    send: (mutation: QueuedMutation) =>
      sendRequest(
        mutation.endpoint,
        mutation.method,
        mutation.payload,
        mutation.clientMutationId,
      ),
    remove: (id) => removeQueuedMutation(id),
    update: (id, patch) => updateQueuedMutation(id, patch),
  };
}

/** Browser-wired deps for the Today replay handler. */
function todayReplayDeps(): TodayReplayDeps {
  return {
    send: (mutation: QueuedMutation) =>
      sendRequest(
        mutation.endpoint,
        mutation.method,
        mutation.payload,
        mutation.clientMutationId,
      ),
    remove: (id) => removeQueuedMutation(id),
    update: (id, patch) => updateQueuedMutation(id, patch),
    onConflict: (info) => notifyTodayConflict(info),
  };
}

/** Replay all queued Today mutations (FIFO), skipping terminal ones. */
async function replayTodayMutations(): Promise<void> {
  const todayMutations = sortQueue(
    (await listQueuedMutations()).filter((m) => isTodayMutationType(m.type)),
  );
  const deps = todayReplayDeps();
  for (const mutation of todayMutations) {
    if (isConflict(mutation) || isPermanentlyFailed(mutation)) continue;
    await todayMutationReplayHandler(mutation, deps);
  }
}

let flushing: Promise<FlushResult> | null = null;

/** Drain the offline queue. Concurrent calls share the in-flight pass. */
export async function flushOfflineQueue(): Promise<FlushResult> {
  if (flushing) return flushing;
  state = { ...state, syncing: true };
  emit();
  flushing = (async () => {
    try {
      // Today mutations first (conflict-aware), then the generic engine.
      await replayTodayMutations();
      const result = await flushQueue(flushDeps());
      const remaining = await countQueuedMutations();
      state = { pending: remaining, syncing: false, lastResult: result };
      emit();
      return { ...result, remaining };
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
// Browser lifecycle registration
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
    navigator.serviceWorker.addEventListener(
      "message",
      (event: MessageEvent) => {
        if (event.data && event.data.type === SW_FLUSH_MESSAGE) {
          void flushOfflineQueue();
        }
      },
    );
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
      reg.active?.postMessage({ type: STORAGE_KEYS.SW_PURGE_CACHES });
    } catch {
      // ignore
    }
  }
  state = { pending: 0, syncing: false, lastResult: null };
  emit();
}
