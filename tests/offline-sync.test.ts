/**
 * Tests for src/lib/offline-sync.ts (RW-042).
 *
 * Pure sync-engine logic — all I/O is injected. Covers status classification,
 * backoff, FIFO ordering, and the flush state machine (success / transient
 * retry / permanent failure / idempotent re-flush).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyStatus,
  backoffDelay,
  sortQueue,
  isPermanentlyFailed,
  flushQueue,
  MAX_MUTATION_RETRIES,
  type QueuedMutation,
  type FlushDeps,
} from "@/lib/offline-sync";

function mut(partial: Partial<QueuedMutation> = {}): QueuedMutation {
  return {
    clientMutationId: partial.clientMutationId ?? "m1",
    type: partial.type ?? "progress",
    endpoint: partial.endpoint ?? "/api/x",
    method: partial.method ?? "POST",
    payload: partial.payload ?? { a: 1 },
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    retryCount: partial.retryCount ?? 0,
    status: partial.status ?? "pending",
    lastError: partial.lastError ?? null,
    dedupeKey: partial.dedupeKey ?? null,
  };
}

// ---------------------------------------------------------------------------
// classifyStatus
// ---------------------------------------------------------------------------

test("classifyStatus: 2xx is success", () => {
  assert.equal(classifyStatus(200), "success");
  assert.equal(classifyStatus(201), "success");
  assert.equal(classifyStatus(204), "success");
});

test("classifyStatus: 409 is success (server already resolved the conflict)", () => {
  assert.equal(classifyStatus(409), "success");
});

test("classifyStatus: 408/429/5xx are retryable", () => {
  assert.equal(classifyStatus(408), "retry");
  assert.equal(classifyStatus(429), "retry");
  assert.equal(classifyStatus(500), "retry");
  assert.equal(classifyStatus(503), "retry");
});

test("classifyStatus: network error (0) is retryable", () => {
  assert.equal(classifyStatus(0), "retry");
});

test("classifyStatus: other 4xx are permanent", () => {
  assert.equal(classifyStatus(400), "permanent");
  assert.equal(classifyStatus(401), "permanent");
  assert.equal(classifyStatus(404), "permanent");
});

// ---------------------------------------------------------------------------
// backoffDelay
// ---------------------------------------------------------------------------

test("backoffDelay grows exponentially and is capped", () => {
  const noJitter = () => 0; // floor of the full-jitter window
  assert.equal(backoffDelay(0, 1000, 60000, noJitter), 500);
  assert.equal(backoffDelay(1, 1000, 60000, noJitter), 1000);
  assert.equal(backoffDelay(2, 1000, 60000, noJitter), 2000);
  // Capped at max/2 (lower bound of the jittered window) for very large attempts.
  assert.equal(backoffDelay(100, 1000, 60000, noJitter), 30000);
});

test("backoffDelay full-jitter stays within [exp/2, exp]", () => {
  const maxJitter = () => 1;
  // attempt 1: exp = 2000 → 1000 (floor) + 1*1000 (jitter) = 2000 (the cap).
  assert.equal(backoffDelay(1, 1000, 60000, maxJitter), 2000);
});

// ---------------------------------------------------------------------------
// sortQueue
// ---------------------------------------------------------------------------

test("sortQueue orders by createdAt then clientMutationId (stable FIFO)", () => {
  const a = mut({ clientMutationId: "b", createdAt: "2026-01-01T00:00:02.000Z" });
  const b = mut({ clientMutationId: "a", createdAt: "2026-01-01T00:00:01.000Z" });
  const c = mut({ clientMutationId: "a", createdAt: "2026-01-01T00:00:02.000Z" });
  const sorted = sortQueue([a, b, c]).map((m) => m.clientMutationId + "@" + m.createdAt);
  assert.deepEqual(sorted, [
    "a@2026-01-01T00:00:01.000Z",
    "a@2026-01-01T00:00:02.000Z",
    "b@2026-01-01T00:00:02.000Z",
  ]);
});

// ---------------------------------------------------------------------------
// isPermanentlyFailed
// ---------------------------------------------------------------------------

test("isPermanentlyFailed true only for failed + exhausted retries", () => {
  assert.equal(isPermanentlyFailed(mut({ status: "failed", retryCount: MAX_MUTATION_RETRIES })), true);
  assert.equal(isPermanentlyFailed(mut({ status: "failed", retryCount: 1 })), false);
  assert.equal(isPermanentlyFailed(mut({ status: "pending", retryCount: 99 })), false);
});

// ---------------------------------------------------------------------------
// flushQueue
// ---------------------------------------------------------------------------

function recordingDeps(
  queue: QueuedMutation[],
  send: (m: QueuedMutation) => Promise<{ status: number }>,
): { deps: FlushDeps; removed: string[]; updated: { id: string; patch: Partial<QueuedMutation> }[] } {
  const removed: string[] = [];
  const updated: { id: string; patch: Partial<QueuedMutation> }[] = [];
  const deps: FlushDeps = {
    list: async () => queue,
    send,
    remove: async (id) => {
      removed.push(id);
    },
    update: async (id, patch) => {
      updated.push({ id, patch });
    },
  };
  return { deps, removed, updated };
}

test("flushQueue removes successfully delivered mutations", async () => {
  const queue = [mut({ clientMutationId: "m1" }), mut({ clientMutationId: "m2", createdAt: "2026-01-01T00:00:01.000Z" })];
  const { deps, removed } = recordingDeps(queue, async () => ({ status: 200 }));
  const result = await flushQueue(deps);
  assert.equal(result.attempted, 2);
  assert.equal(result.succeeded, 2);
  assert.equal(result.remaining, 0);
  assert.deepEqual(removed.sort(), ["m1", "m2"]);
});

test("flushQueue retries transient failures and bumps retryCount", async () => {
  const queue = [mut({ clientMutationId: "m1", retryCount: 0 })];
  const { deps, removed, updated } = recordingDeps(queue, async () => ({ status: 503 }));
  const result = await flushQueue(deps);
  assert.equal(result.retried, 1);
  assert.equal(result.succeeded, 0);
  assert.equal(removed.length, 0);
  assert.equal(updated[0].patch.status, "pending");
  assert.equal(updated[0].patch.retryCount, 1);
});

test("flushQueue flags permanent (4xx) failures immediately", async () => {
  const queue = [mut({ clientMutationId: "m1" })];
  const { deps, updated } = recordingDeps(queue, async () => ({ status: 400 }));
  const result = await flushQueue(deps);
  assert.equal(result.failed, 1);
  assert.equal(updated[0].patch.status, "failed");
});

test("flushQueue flags failed after exhausting retries", async () => {
  const queue = [mut({ clientMutationId: "m1", retryCount: MAX_MUTATION_RETRIES - 1 })];
  const { deps, updated } = recordingDeps(queue, async () => ({ status: 500 }));
  const result = await flushQueue(deps);
  assert.equal(result.failed, 1);
  assert.equal(updated[0].patch.status, "failed");
  assert.equal(updated[0].patch.retryCount, MAX_MUTATION_RETRIES);
});

test("flushQueue treats a thrown send (network error) as retryable", async () => {
  const queue = [mut({ clientMutationId: "m1", retryCount: 0 })];
  const { deps, updated } = recordingDeps(queue, async () => {
    throw new Error("network down");
  });
  const result = await flushQueue(deps);
  assert.equal(result.retried, 1);
  assert.equal(updated[0].patch.status, "pending");
  assert.equal(updated[0].patch.lastError, "network down");
});

test("flushQueue skips already-permanently-failed mutations (idempotent re-flush)", async () => {
  let sends = 0;
  const queue = [mut({ clientMutationId: "dead", status: "failed", retryCount: MAX_MUTATION_RETRIES })];
  const { deps, removed } = recordingDeps(queue, async () => {
    sends++;
    return { status: 200 };
  });
  const result = await flushQueue(deps);
  assert.equal(sends, 0, "permanently-failed mutation is not re-sent");
  assert.equal(result.attempted, 0);
  assert.equal(removed.length, 0);
});

test("flushQueue delivers in FIFO order", async () => {
  const order: string[] = [];
  const queue = [
    mut({ clientMutationId: "late", createdAt: "2026-01-01T00:00:09.000Z" }),
    mut({ clientMutationId: "early", createdAt: "2026-01-01T00:00:01.000Z" }),
  ];
  const { deps } = recordingDeps(queue, async (m) => {
    order.push(m.clientMutationId);
    return { status: 200 };
  });
  await flushQueue(deps);
  assert.deepEqual(order, ["early", "late"]);
});
