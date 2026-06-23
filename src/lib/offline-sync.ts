/**
 * Offline mutation sync engine (RW-042).
 *
 * The pure, dependency-injected core of the offline mutation queue. It contains
 * NO IndexedDB / network / DOM access so every decision (ordering, retry,
 * backoff, success/failure classification) is unit-testable in plain Node. The
 * browser glue lives in:
 *   - `offline-db.ts`        — IndexedDB persistence of the queue.
 *   - `offline-mutations.ts` — enqueue-or-send wiring + connectivity listeners.
 */

export type MutationStatus = "pending" | "syncing" | "failed";

/** A single durable mutation awaiting delivery to its endpoint. */
export interface QueuedMutation {
  /** Idempotency key — primary key in IndexedDB and the dedupe key server-side. */
  clientMutationId: string;
  /** Logical kind, e.g. "progress" | "saveWord" | "highlight.note" | "quiz.attempt". */
  type: string;
  /** Resolved request URL. */
  endpoint: string;
  /** HTTP method (POST / PATCH / DELETE). */
  method: string;
  /** JSON-serializable request body (null for bodyless requests). */
  payload: unknown;
  /** ISO timestamp when first enqueued. */
  createdAt: string;
  /** Number of delivery attempts so far. */
  retryCount: number;
  status: MutationStatus;
  /** Last error message (for diagnostics / the sync indicator). */
  lastError?: string | null;
  /**
   * Optional collapse key. When set, enqueuing a new mutation with the same
   * `dedupeKey` replaces any pending one (e.g. only the latest scroll progress
   * or the latest note edit for a highlight needs to be synced).
   */
  dedupeKey?: string | null;
}

/** Maximum delivery attempts before a mutation is treated as permanently failed. */
export const MAX_MUTATION_RETRIES = 5;

/** Exponential backoff base + cap (milliseconds). */
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

export type SendOutcome = "success" | "retry" | "permanent";

/**
 * Classify an HTTP status code (or 0 for a network error) into a sync outcome:
 *   - success:   2xx, or 409 (the server already resolved the conflict via
 *                forward-only / last-write-wins, so retrying is pointless).
 *   - retry:     network errors, 5xx, 408, 429 — transient, try again later.
 *   - permanent: other 4xx — a malformed/forbidden request won't fix itself.
 */
export function classifyStatus(status: number): SendOutcome {
  if (status >= 200 && status < 300) return "success";
  if (status === 409) return "success";
  if (status === 408 || status === 429) return "retry";
  if (status >= 400 && status < 500) return "permanent";
  return "retry";
}

/**
 * Exponential backoff with full jitter. Deterministic when `rng` is supplied.
 * Returns the delay in milliseconds before attempt number `retryCount`.
 */
export function backoffDelay(
  retryCount: number,
  base = BACKOFF_BASE_MS,
  max = BACKOFF_MAX_MS,
  rng: () => number = Math.random,
): number {
  const safe = Math.max(0, retryCount);
  const exp = Math.min(max, base * 2 ** safe);
  return Math.round(exp / 2 + rng() * (exp / 2));
}

/**
 * Stable FIFO ordering: oldest `createdAt` first, ties broken deterministically
 * by `clientMutationId` so the flush order never depends on IndexedDB internals.
 */
export function sortQueue(mutations: QueuedMutation[]): QueuedMutation[] {
  return [...mutations].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    if (a.clientMutationId === b.clientMutationId) return 0;
    return a.clientMutationId < b.clientMutationId ? -1 : 1;
  });
}

/** A mutation is permanently dead when it has failed and exhausted its retries. */
export function isPermanentlyFailed(
  mutation: QueuedMutation,
  maxRetries = MAX_MUTATION_RETRIES,
): boolean {
  return mutation.status === "failed" && mutation.retryCount >= maxRetries;
}

export interface FlushDeps {
  list: () => Promise<QueuedMutation[]>;
  send: (mutation: QueuedMutation) => Promise<{ status: number }>;
  remove: (clientMutationId: string) => Promise<void>;
  update: (clientMutationId: string, patch: Partial<QueuedMutation>) => Promise<void>;
}

export interface FlushResult {
  /** Mutations we actually tried to deliver this pass. */
  attempted: number;
  /** Delivered successfully (removed from the queue). */
  succeeded: number;
  /** Failed transiently and re-queued for a later attempt. */
  retried: number;
  /** Failed permanently (kept in the queue, flagged for the user). */
  failed: number;
  /** Mutations still in the queue after this pass (pending + failed). */
  remaining: number;
}

function emptyResult(): FlushResult {
  return { attempted: 0, succeeded: 0, retried: 0, failed: 0, remaining: 0 };
}

/**
 * Deliver every queued mutation in FIFO order, applying the retry/backoff
 * policy. Already-permanently-failed mutations are skipped (left for the user
 * to discard). Successes are removed; transient failures bump `retryCount` and
 * stay `pending` until they exhaust `maxRetries`, after which they are flagged
 * `failed`. Permanent (client-error) failures are flagged `failed` immediately.
 *
 * Pure orchestration — all I/O is injected via {@link FlushDeps}.
 */
export async function flushQueue(
  deps: FlushDeps,
  opts: { maxRetries?: number } = {},
): Promise<FlushResult> {
  const maxRetries = opts.maxRetries ?? MAX_MUTATION_RETRIES;
  const queue = sortQueue(await deps.list());
  const result = emptyResult();

  for (const mutation of queue) {
    if (isPermanentlyFailed(mutation, maxRetries)) {
      continue;
    }

    result.attempted++;
    let outcome: SendOutcome;
    let errorMessage: string | null = null;
    try {
      const { status } = await deps.send(mutation);
      outcome = classifyStatus(status);
      if (outcome !== "success") errorMessage = `HTTP ${status}`;
    } catch (err) {
      outcome = "retry";
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    if (outcome === "success") {
      await deps.remove(mutation.clientMutationId);
      result.succeeded++;
      continue;
    }

    const nextRetry = mutation.retryCount + 1;
    if (outcome === "permanent" || nextRetry >= maxRetries) {
      await deps.update(mutation.clientMutationId, {
        status: "failed",
        retryCount: nextRetry,
        lastError: errorMessage,
      });
      result.failed++;
    } else {
      await deps.update(mutation.clientMutationId, {
        status: "pending",
        retryCount: nextRetry,
        lastError: errorMessage,
      });
      result.retried++;
    }
  }

  result.remaining = queue.length - result.succeeded;
  return result;
}
