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
  OFFLINE_NETWORK_ERROR,
  OFFLINE_ACTOR_HEADER,
  type FlushDeps,
  type FlushResult,
  type QueuedMutation,
} from "@/lib/offline-sync";
import {
  enqueueMutation,
  listQueuedMutations,
  updateQueuedMutationForGeneration,
  countQueuedMutations,
  clearQueuedMutations,
  queuedMutationsBelongTo,
  discardQueuedMutation,
  replaceQueuedMutationPayload,
  removeQueuedMutationForGeneration,
} from "./mutation-store";
import {
  isTodayMutationType,
  isAllowedTodayPayload,
  isValidLocalDate,
  isValidTimezoneString,
} from "./registry";
import { purgeOfflineData } from "./article-store";
import { STORAGE_KEYS, lsGet, lsRemove, lsSet } from "@/lib/storage-keys";

/** Header carrying the idempotency key to the server on every send. */
export const MUTATION_HEADER = "x-client-mutation-id";

/** Service-worker Background Sync tag + message type used to trigger a flush. */
export const SYNC_TAG = "readwise-mutations";
const SW_FLUSH_MESSAGE = STORAGE_KEYS.SW_FLUSH_QUEUE;
const BODYLESS_METHODS = new Set(["GET", "DELETE"]);
const SUCCESS_STATUS_MIN = 200;
const SUCCESS_STATUS_MAX_EXCLUSIVE = 300;
const FLUSH_LOCK_NAME = "readwise-offline-queue-flush";
let localPurgeGeneration = 0;
let currentOfflineActorId: string | null = null;
let offlineActorInitialized = false;
let offlineActorReady = false;
let actorTransitionVersion = 0;
let actorTransitionTail: Promise<void> = Promise.resolve();

type PurgeGeneration = {
  local: number;
  shared: string | null;
  actorId: string | null;
};

export type OfflineMutationGeneration = Readonly<PurgeGeneration>;

export interface MutationSpec {
  type: string;
  endpoint: string;
  method?: string;
  body?: unknown;
  /** Optional collapse key (see {@link enqueueMutation}). */
  dedupeKey?: string;
  /** Causal predecessor that must be delivered before this mutation. */
  dependsOnClientMutationId?: string;
  /** Causal predecessors that must all be delivered before this mutation. */
  dependsOnClientMutationIds?: string[];
  /**
   * Optional caller-supplied idempotency key. When omitted a fresh one is
   * generated. Supply it when the SAME logical mutation may be attempted both
   * online (in the component) and then queued on failure, so a partially
   * applied online attempt and the queued retry share one key and can't double
   * apply (e.g. a quiz attempt).
   */
  clientMutationId?: string;
  /** Generation captured before any caller-managed network attempt. */
  generation?: OfflineMutationGeneration;
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

function readPurgeGeneration(): PurgeGeneration {
  return {
    local: localPurgeGeneration,
    shared: lsGet(STORAGE_KEYS.OFFLINE_PURGE_GENERATION),
    actorId: currentOfflineActorId,
  };
}

export function captureOfflineMutationGeneration(): OfflineMutationGeneration {
  const current = readPurgeGeneration();
  if (current.shared !== null || typeof window === "undefined") {
    return current;
  }
  const token = `${newMutationId()}:${Date.now()}:${localPurgeGeneration}`;
  lsSet(STORAGE_KEYS.OFFLINE_PURGE_GENERATION, token);
  return {
    local: localPurgeGeneration,
    shared:
      lsGet(STORAGE_KEYS.OFFLINE_PURGE_GENERATION) === token
        ? token
        : null,
    actorId: current.actorId,
  };
}

function isCurrentPurgeGeneration(expected: PurgeGeneration): boolean {
  const current = readPurgeGeneration();
  return (
    offlineActorReady &&
    expected.actorId !== null &&
    lsGet(STORAGE_KEYS.OFFLINE_ACCESS_BLOCKED) !== "1" &&
    lsGet(STORAGE_KEYS.OFFLINE_ACTOR_ID) === expected.actorId &&
    current.local === expected.local &&
    current.shared === expected.shared &&
    current.actorId === expected.actorId
  );
}

export function isOfflineMutationGenerationCurrent(
  expected: OfflineMutationGeneration,
): boolean {
  return isCurrentPurgeGeneration(expected);
}

function invalidateQueuedSnapshots(): boolean {
  localPurgeGeneration += 1;
  const token = `${newMutationId()}:${Date.now()}:${localPurgeGeneration}`;
  lsSet(STORAGE_KEYS.OFFLINE_PURGE_GENERATION, token);
  return lsGet(STORAGE_KEYS.OFFLINE_PURGE_GENERATION) === token;
}

/**
 * Establish the authenticated owner of browser-side offline data. The first
 * resolved session preserves same-account queued work across reloads; every
 * later account transition purges private stores before syncing is re-enabled.
 */
export async function setOfflineSyncActor(actorId: string | null): Promise<void> {
  const durableActorId = lsGet(STORAGE_KEYS.OFFLINE_ACTOR_ID);
  const accessBlocked =
    lsGet(STORAGE_KEYS.OFFLINE_ACCESS_BLOCKED) === "1";
  if (actorId === null) {
    offlineActorInitialized = true;
    if (durableActorId && !accessBlocked) {
      currentOfflineActorId = durableActorId;
      offlineActorReady = true;
    } else {
      currentOfflineActorId = null;
      offlineActorReady = false;
    }
    await actorTransitionTail;
    return;
  }

  if (
    !offlineActorInitialized &&
    durableActorId === actorId &&
    !accessBlocked &&
    lsGet(STORAGE_KEYS.OFFLINE_PURGE_GENERATION) !== null
  ) {
    // A fresh same-account tab must not toggle shared ownership keys: sibling
    // tabs would interpret that transient write as an account transition.
    offlineActorInitialized = true;
    currentOfflineActorId = actorId;
    offlineActorReady = true;
    return;
  }

  if (
    offlineActorInitialized &&
    currentOfflineActorId === actorId &&
    (actorId === null || offlineActorReady)
  ) {
    return;
  }

  offlineActorInitialized = true;
  currentOfflineActorId = actorId;
  offlineActorReady = false;
  const transitionVersion = ++actorTransitionVersion;

  const priorDurableActorId = durableActorId;
  lsSet(STORAGE_KEYS.OFFLINE_ACCESS_BLOCKED, "1");
  lsRemove(STORAGE_KEYS.OFFLINE_ACTOR_ID);

  const transition = actorTransitionTail.then(async () => {
    if (
      transitionVersion !== actorTransitionVersion ||
      currentOfflineActorId !== actorId
    ) {
      return;
    }
    if (priorDurableActorId !== actorId || accessBlocked) {
      const sharedGeneration = lsGet(
        STORAGE_KEYS.OFFLINE_PURGE_GENERATION,
      );
      const canAdoptQueue =
        priorDurableActorId === null &&
        sharedGeneration !== null &&
        (await queuedMutationsBelongTo(actorId, sharedGeneration));
      if (canAdoptQueue) {
        if (!(await purgeOfflineData())) {
          throw new Error("Offline private data could not be cleared");
        }
      } else {
        await purgeOfflineUserData();
      }
    }
    if (
      transitionVersion !== actorTransitionVersion ||
      currentOfflineActorId !== actorId
    ) {
      return;
    }
    lsSet(STORAGE_KEYS.OFFLINE_ACTOR_ID, actorId);
    const generation = captureOfflineMutationGeneration();
    lsRemove(STORAGE_KEYS.OFFLINE_ACCESS_BLOCKED);
    offlineActorReady =
      lsGet(STORAGE_KEYS.OFFLINE_ACTOR_ID) === actorId &&
      lsGet(STORAGE_KEYS.OFFLINE_ACCESS_BLOCKED) !== "1" &&
      (generation.shared !== null || typeof window === "undefined");
    if (!offlineActorReady) {
      throw new Error("Offline account ownership could not be persisted");
    }
  });
  actorTransitionTail = transition.catch(() => undefined);
  await transition;
}

/** Permanently hide retained offline data after irreversible account deletion. */
export function disableOfflineUserDataAccess(): void {
  actorTransitionVersion += 1;
  currentOfflineActorId = null;
  offlineActorReady = false;
  lsSet(STORAGE_KEYS.OFFLINE_ACCESS_BLOCKED, "1");
  lsRemove(STORAGE_KEYS.OFFLINE_ACTOR_ID);
  invalidateQueuedSnapshots();
}

/** Block every tab before clearing private data for an explicit sign-out. */
export async function prepareOfflineSignOut(): Promise<void> {
  const actorId =
    currentOfflineActorId ?? lsGet(STORAGE_KEYS.OFFLINE_ACTOR_ID);
  actorTransitionVersion += 1;
  currentOfflineActorId = null;
  offlineActorReady = false;
  lsSet(STORAGE_KEYS.OFFLINE_ACCESS_BLOCKED, "1");
  lsRemove(STORAGE_KEYS.OFFLINE_ACTOR_ID);
  await actorTransitionTail;
  try {
    await purgeOfflineUserData();
  } catch (error) {
    if (actorId) {
      currentOfflineActorId = actorId;
      lsSet(STORAGE_KEYS.OFFLINE_ACTOR_ID, actorId);
      lsRemove(STORAGE_KEYS.OFFLINE_ACCESS_BLOCKED);
      offlineActorReady =
        lsGet(STORAGE_KEYS.OFFLINE_ACTOR_ID) === actorId;
    }
    throw error;
  }
}

async function sendRequest(
  endpoint: string,
  method: string,
  payload: unknown,
  clientMutationId: string,
  actorId: string | null,
): Promise<{ status: number }> {
  const hasBody = payload != null && !BODYLESS_METHODS.has(method);
  const res = await fetch(endpoint, {
    method,
    headers: {
      "Content-Type": "application/json",
      [MUTATION_HEADER]: clientMutationId,
      ...(actorId ? { [OFFLINE_ACTOR_HEADER]: actorId } : {}),
    },
    body: hasBody ? JSON.stringify(payload) : undefined,
  });
  return { status: res.status };
}

function sendQueuedMutation(
  mutation: QueuedMutation,
): Promise<{ status: number }> {
  return sendRequest(
    mutation.endpoint,
    mutation.method,
    mutation.payload,
    mutation.clientMutationId,
    mutation.actorId ?? null,
  );
}

function sendQueuedMutationForGeneration(
  generation: PurgeGeneration,
  mutation: QueuedMutation,
): Promise<{ status: number }> {
  if (!isCurrentPurgeGeneration(generation)) {
    throw new Error("Offline queue invalidated by privacy purge");
  }
  return sendQueuedMutation(mutation);
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
  const generation =
    spec.generation ?? captureOfflineMutationGeneration();
  if (!isCurrentPurgeGeneration(generation)) {
    return { sent: false, queued: false };
  }
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
        generation.actorId,
      );
      const outcome = classifyStatus(status);
      if (outcome === "success") return { sent: true, queued: false, status };
      if (outcome === "permanent") return { sent: false, queued: false, status };
      // Transient (5xx/429/408) — fall through to enqueue for retry.
    } catch {
      // Network error — fall through to enqueue.
    }
  }

  return queueMutation({ ...spec, clientMutationId, generation });
}

/**
 * Store a mutation for later delivery without attempting the network first.
 * Used by deep client modules that already attempted a richer immediate
 * delivery (for example, one that needs a parsed response body) and need to
 * fall back to the same durable queue under the same idempotency key.
 */
export async function queueMutation(
  spec: MutationSpec,
): Promise<SubmitResult> {
  const generation =
    spec.generation ?? captureOfflineMutationGeneration();
  if (
    !isCurrentPurgeGeneration(generation) ||
    (typeof window !== "undefined" && generation.shared === null)
  ) {
    return { sent: false, queued: false };
  }
  const clientMutationId = spec.clientMutationId ?? newMutationId();
  const method = spec.method ?? "POST";
  const payload = spec.body ?? null;

  const queued = await enqueueMutation({
    clientMutationId,
    type: spec.type,
    endpoint: spec.endpoint,
    method,
    payload,
    purgeGeneration: generation.shared,
    actorId: generation.actorId ?? undefined,
    dedupeKey: spec.dedupeKey ?? null,
    dependsOnClientMutationId: spec.dependsOnClientMutationId ?? null,
    dependsOnClientMutationIds: spec.dependsOnClientMutationIds ?? null,
  });
  await refreshPending();
  if (!queued) return { sent: false, queued: false };
  if (!isCurrentPurgeGeneration(generation)) {
    await discardPendingMutation(clientMutationId);
    return { sent: false, queued: false };
  }
  // The mutation is durable once IndexedDB and the pending-state refresh
  // complete. Service-worker readiness is optional and may never settle, so it
  // must not hold the caller's queued acknowledgement (or UI busy state) open.
  void requestBackgroundSync();
  return { sent: false, queued: true };
}

/** Update a not-yet-delivered mutation without exposing the IndexedDB store. */
export async function replacePendingMutationBody(
  clientMutationId: string,
  body: unknown,
): Promise<boolean> {
  return replaceQueuedMutationPayload(clientMutationId, body);
}

/** Cancel a not-yet-delivered mutation and refresh the public pending count. */
export async function discardPendingMutation(
  clientMutationId: string,
): Promise<boolean> {
  const discarded = await discardQueuedMutation(clientMutationId);
  if (discarded) await refreshPending();
  return discarded;
}

// ---------------------------------------------------------------------------
// Today offline mutation replay (#811)
// ---------------------------------------------------------------------------

/** Injected dependencies for {@link todayMutationReplayHandler} (testable in Node). */
export interface TodayReplayDeps {
  send: (mutation: QueuedMutation) => Promise<{ status: number }>;
  remove: (mutation: QueuedMutation) => Promise<void>;
  update: (
    mutation: QueuedMutation,
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

  // 1. Privacy + shape validation. Never send (or keep retrying) a payload that
  //    is malformed or carries fields outside the allowed Today set.
  if (!isValidTodayReplayMutation(mutation)) {
    await deps.update(mutation, {
      status: "failed",
      lastError: "invalid Today mutation payload",
    });
    return "invalid";
  }

  // 2. Deliver.
  let status: number;
  try {
    ({ status } = await deps.send(mutation));
  } catch {
    return retryOrFail(mutation, deps, maxRetries, OFFLINE_NETWORK_ERROR);
  }

  // 3. Success (incl. idempotent no-op) — drop from the queue.
  if (isSuccessfulStatus(status)) {
    await deps.remove(mutation);
    return "removed";
  }

  // 4. Conflict — the server already resolved this elsewhere. Non-destructive.
  if (status === 409) {
    return markTodayConflict(mutation, deps, status);
  }

  // 5. Transient — retry with back-off.
  if (isTodayRetryableStatus(status)) {
    return retryOrFail(mutation, deps, maxRetries, `HTTP ${status}`);
  }

  // 6. Other 4xx — permanent failure.
  return markTodayFailed(mutation, deps, `HTTP ${status}`);
}

function isSuccessfulStatus(status: number): boolean {
  return status >= SUCCESS_STATUS_MIN && status < SUCCESS_STATUS_MAX_EXCLUSIVE;
}

async function markTodayConflict(
  mutation: QueuedMutation,
  deps: TodayReplayDeps,
  status: number,
): Promise<TodayReplayOutcome> {
  await deps.update(mutation, {
    status: "conflict",
    lastError: `HTTP ${status}`,
  });
  deps.onConflict?.({ mutationType: mutation.type, statusCode: status });
  return "conflict";
}

async function markTodayFailed(
  mutation: QueuedMutation,
  deps: TodayReplayDeps,
  lastError: string,
): Promise<TodayReplayOutcome> {
  await deps.update(mutation, {
    status: "failed",
    retryCount: mutation.retryCount + 1,
    lastError,
  });
  return "failed";
}

function isValidTodayReplayMutation(mutation: QueuedMutation): boolean {
  const payload = mutation.payload;
  const rec = (payload ?? {}) as Record<string, unknown>;
  return (
    isTodayMutationType(mutation.type) &&
    isAllowedTodayPayload(payload) &&
    isValidLocalDate(rec.localDate) &&
    (rec.timezone === undefined || isValidTimezoneString(rec.timezone))
  );
}

function isTodayRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
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
    await deps.update(mutation, {
      status: "failed",
      retryCount: nextRetry,
      lastError: errorMessage,
    });
    return "failed";
  }
  await deps.update(mutation, {
    status: "pending",
    retryCount: nextRetry,
    lastError: errorMessage,
  });
  return "retry";
}

// ---------------------------------------------------------------------------
// Flushing
// ---------------------------------------------------------------------------

function isMutationFromGeneration(
  mutation: QueuedMutation,
  generation: PurgeGeneration,
): boolean {
  return (
    generation.actorId !== null &&
    mutation.purgeGeneration === generation.shared &&
    mutation.actorId === generation.actorId
  );
}

async function currentQueuedMutations(
  generation: PurgeGeneration,
): Promise<QueuedMutation[]> {
  if (!isCurrentPurgeGeneration(generation)) return [];
  const mutations = await listQueuedMutations();
  if (!isCurrentPurgeGeneration(generation)) return [];
  const current: QueuedMutation[] = [];
  for (const mutation of mutations) {
    if (!isCurrentPurgeGeneration(generation)) return [];
    if (isMutationFromGeneration(mutation, generation)) {
      current.push(mutation);
    } else {
      await removeQueuedMutationForGeneration(
        mutation.clientMutationId,
        mutation.purgeGeneration,
        mutation.actorId,
        mutation.createdAt,
        mutation.queueRevision,
      );
    }
  }
  return current;
}

function flushDeps(generation: PurgeGeneration): FlushDeps {
  return {
    // The generic engine handles every NON-Today mutation; Today mutations are
    // drained separately by `replayTodayMutations` so a 409 becomes a conflict
    // (not a resolved no-op as `classifyStatus` would otherwise treat it).
    list: async () =>
      (await currentQueuedMutations(generation)).filter(
        (m) => !isTodayMutationType(m.type),
      ),
    send: (mutation) =>
      sendQueuedMutationForGeneration(generation, mutation),
    remove: async (mutation) => {
      await removeQueuedMutationForGeneration(
        mutation.clientMutationId,
        mutation.purgeGeneration,
        mutation.actorId,
        mutation.createdAt,
        mutation.queueRevision,
      );
    },
    update: async (mutation, patch) => {
      await updateQueuedMutationForGeneration(
        mutation.clientMutationId,
        mutation.purgeGeneration,
        mutation.actorId,
        mutation.createdAt,
        mutation.queueRevision,
        patch,
      );
    },
  };
}

/** Browser-wired deps for the Today replay handler. */
function todayReplayDeps(generation: PurgeGeneration): TodayReplayDeps {
  return {
    send: (mutation) =>
      sendQueuedMutationForGeneration(generation, mutation),
    remove: async (mutation) => {
      await removeQueuedMutationForGeneration(
        mutation.clientMutationId,
        mutation.purgeGeneration,
        mutation.actorId,
        mutation.createdAt,
        mutation.queueRevision,
      );
    },
    update: async (mutation, patch) => {
      await updateQueuedMutationForGeneration(
        mutation.clientMutationId,
        mutation.purgeGeneration,
        mutation.actorId,
        mutation.createdAt,
        mutation.queueRevision,
        patch,
      );
    },
    onConflict: (info) => notifyTodayConflict(info),
  };
}

/** Replay all queued Today mutations (FIFO), skipping terminal ones. */
async function replayTodayMutations(
  generation: PurgeGeneration,
): Promise<void> {
  const todayMutations = sortQueue(
    (await currentQueuedMutations(generation)).filter((m) =>
      isTodayMutationType(m.type),
    ),
  );
  const deps = todayReplayDeps(generation);
  for (const mutation of todayMutations) {
    if (isTerminalQueuedMutation(mutation)) continue;
    await todayMutationReplayHandler(mutation, deps);
  }
}

function isTerminalQueuedMutation(mutation: QueuedMutation): boolean {
  return isConflict(mutation) || isPermanentlyFailed(mutation);
}

let flushing: Promise<FlushResult> | null = null;

export async function withOriginFlushLock<T>(
  work: () => Promise<T>,
): Promise<T> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return work();
  }
  if (typeof navigator.locks?.request !== "function") {
    throw new Error("Origin-wide offline queue locking is unavailable");
  }
  return navigator.locks.request(
    FLUSH_LOCK_NAME,
    { mode: "exclusive" },
    work,
  );
}

/**
 * Drain the offline queue. Calls in this tab share the in-flight pass, while
 * the origin-wide Web Lock serializes separate tabs before either reads the
 * shared IndexedDB queue.
 */
export async function flushOfflineQueue(): Promise<FlushResult> {
  if (flushing) return flushing;
  state = { ...state, syncing: true };
  emit();
  flushing = (async () => {
    try {
      return await withOriginFlushLock(async () => {
        const generation = readPurgeGeneration();
        // Today mutations first (conflict-aware), then the generic engine.
        await replayTodayMutations(generation);
        const result = await flushQueue(flushDeps(generation));
        const remaining = await countQueuedMutations();
        state = { pending: remaining, syncing: false, lastResult: result };
        emit();
        return { ...result, remaining };
      });
    } catch {
      const fallback = emptyFlushResult(await countQueuedMutations());
      state = { ...state, syncing: false };
      emit();
      return fallback;
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

function emptyFlushResult(remaining: number): FlushResult {
  return {
    attempted: 0,
    succeeded: 0,
    retried: 0,
    failed: 0,
    remaining,
  };
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
  const sharedGenerationUpdated = invalidateQueuedSnapshots();
  const clearPrivateStores = async (): Promise<boolean> => {
    let queueCleared = false;
    try {
      queueCleared = await clearQueuedMutations();
    } catch {
      queueCleared = false;
    }
    try {
      return queueCleared && (await purgeOfflineData());
    } catch {
      return false;
    }
  };
  const canUseOriginLock =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.locks?.request === "function";
  let privateStoresCleared: boolean;
  if (!sharedGenerationUpdated && canUseOriginLock) {
    privateStoresCleared = await withOriginFlushLock(clearPrivateStores);
  } else {
    privateStoresCleared = await clearPrivateStores();
  }
  const postClearGenerationUpdated = invalidateQueuedSnapshots();
  if (!postClearGenerationUpdated && canUseOriginLock) {
    await withOriginFlushLock(async () => undefined);
  }
  // Ask the service worker to drop its runtime caches too.
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    try {
      const container = navigator.serviceWorker;
      const active =
        container.controller ??
        (typeof container.getRegistration === "function"
          ? (await container.getRegistration())?.active
          : null);
      active?.postMessage({ type: STORAGE_KEYS.SW_PURGE_CACHES });
    } catch {
      // ignore
    }
  }
  state = { pending: 0, syncing: false, lastResult: null };
  emit();
  if (!privateStoresCleared) {
    throw new Error("Offline private data could not be cleared");
  }
}
