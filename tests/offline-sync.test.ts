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

type SendResult = { status: number };
type RecordedUpdate = { id: string; patch: Partial<QueuedMutation> };

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

function assertStatusClassifications(
  expected: ReturnType<typeof classifyStatus>,
  statuses: number[],
) {
  for (const status of statuses) {
    assert.equal(classifyStatus(status), expected, `status ${status}`);
  }
}

// ---------------------------------------------------------------------------
// classifyStatus
// ---------------------------------------------------------------------------

test("classifyStatus: 2xx is success", () => {
  assertStatusClassifications("success", [200, 201, 204]);
});

test("classifyStatus: 409 is success (server already resolved the conflict)", () => {
  assert.equal(classifyStatus(409), "success");
});

test("classifyStatus: 408/429/5xx are retryable", () => {
  assertStatusClassifications("retry", [408, 429, 500, 503]);
});

test("classifyStatus: network error (0) is retryable", () => {
  assert.equal(classifyStatus(0), "retry");
});

test("classifyStatus: other 4xx are permanent", () => {
  assertStatusClassifications("permanent", [400, 401, 404]);
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
  send: (m: QueuedMutation) => Promise<SendResult>,
): { deps: FlushDeps; removed: string[]; updated: RecordedUpdate[] } {
  const removed: string[] = [];
  const updated: RecordedUpdate[] = [];
  const deps: FlushDeps = {
    list: async () => queue,
    send,
    remove: async (mutation) => {
      removed.push(mutation.clientMutationId);
    },
    update: async (mutation, patch) => {
      updated.push({ id: mutation.clientMutationId, patch });
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
  assert.equal(updated[0].patch.retryCount, MAX_MUTATION_RETRIES);
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
    throw new Error("network failed while sending a private selected sentence");
  });
  const result = await flushQueue(deps);
  assert.equal(result.retried, 1);
  assert.equal(updated[0].patch.status, "pending");
  assert.equal(updated[0].patch.lastError, "network_error");
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

test("flushQueue defers destructive dependents when their create is not delivered", async () => {
  const sent: string[] = [];
  const queue = [
    mut({ clientMutationId: "create", type: "highlight.create" }),
    {
      ...mut({
        clientMutationId: "delete-original",
        type: "highlight.delete",
      }),
      dependsOnClientMutationId: "create",
    } as QueuedMutation,
  ];
  const { deps, removed } = recordingDeps(queue, async (mutation) => {
    sent.push(mutation.clientMutationId);
    return { status: mutation.clientMutationId === "create" ? 503 : 204 };
  });

  const result = await flushQueue(deps);

  assert.deepEqual(sent, ["create"]);
  assert.deepEqual(removed, []);
  assert.equal(result.retried, 1);
  assert.equal(result.attempted, 1);
});

test("flushQueue delivers a dependent delete only after its create succeeds", async () => {
  const sent: string[] = [];
  const createdAt = "2026-01-01T00:00:00.000Z";
  const queue = [
    {
      ...mut({
        clientMutationId: "a-delete",
        type: "highlight.delete",
        createdAt,
      }),
      dependsOnClientMutationId: "z-create",
    },
    mut({
      clientMutationId: "z-create",
      type: "highlight.create",
      createdAt,
    }),
  ];
  const { deps, removed } = recordingDeps(queue, async (mutation) => {
    sent.push(mutation.clientMutationId);
    return { status: mutation.type === "highlight.create" ? 201 : 204 };
  });

  const result = await flushQueue(deps);

  assert.deepEqual(sent, ["z-create", "a-delete"]);
  assert.deepEqual(removed, ["z-create", "a-delete"]);
  assert.equal(result.succeeded, 2);
});

test("flushQueue defers anchor recreation until a transient delete succeeds", async () => {
  let queue = [
    mut({
      clientMutationId: "delete-old",
      type: "highlight.delete",
      method: "DELETE",
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    {
      ...mut({
        clientMutationId: "create-new",
        type: "highlight.create",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
      dependsOnClientMutationId: "delete-old",
    },
  ];
  const sent: string[] = [];
  let deleteAttempts = 0;
  const deps: FlushDeps = {
    list: async () => queue,
    send: async (mutation) => {
      sent.push(mutation.clientMutationId);
      if (mutation.clientMutationId === "delete-old") {
        deleteAttempts += 1;
        return { status: deleteAttempts === 1 ? 503 : 204 };
      }
      return { status: 201 };
    },
    remove: async (delivered) => {
      queue = queue.filter(
        (mutation) =>
          mutation.clientMutationId !== delivered.clientMutationId,
      );
    },
    update: async (target, patch) => {
      queue = queue.map((mutation) =>
        mutation.clientMutationId === target.clientMutationId
          ? { ...mutation, ...patch }
          : mutation,
      );
    },
  };

  const first = await flushQueue(deps);
  assert.deepEqual(sent, ["delete-old"]);
  assert.equal(first.retried, 1);
  assert.equal(queue.length, 2);

  const second = await flushQueue(deps);
  assert.deepEqual(sent, ["delete-old", "delete-old", "create-new"]);
  assert.equal(second.succeeded, 2);
  assert.deepEqual(queue, []);
});

test("flushQueue waits for every replacement dependency before deleting an optimistic original", async () => {
  const sent: string[] = [];
  const queue = [
    mut({
      clientMutationId: "original-create",
      type: "highlight.create",
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    mut({
      clientMutationId: "replacement-create",
      type: "highlight.create",
      createdAt: "2026-01-01T00:00:01.000Z",
    }),
    {
      ...mut({
        clientMutationId: "delete-original",
        type: "highlight.delete",
        createdAt: "2026-01-01T00:00:02.000Z",
      }),
      dependsOnClientMutationIds: [
        "original-create",
        "replacement-create",
      ],
    },
  ];
  const { deps, removed } = recordingDeps(queue, async (mutation) => {
    sent.push(mutation.clientMutationId);
    return {
      status: mutation.clientMutationId === "replacement-create" ? 503 : 201,
    };
  });

  const result = await flushQueue(deps);

  assert.deepEqual(sent, ["original-create", "replacement-create"]);
  assert.deepEqual(removed, ["original-create"]);
  assert.equal(result.retried, 1);
  assert.equal(result.attempted, 2);
});

test("flushQueue deletes an optimistic original only after both creates succeed", async () => {
  const sent: string[] = [];
  const queue = [
    mut({
      clientMutationId: "original-create",
      type: "highlight.create",
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    mut({
      clientMutationId: "replacement-create",
      type: "highlight.create",
      createdAt: "2026-01-01T00:00:01.000Z",
    }),
    {
      ...mut({
        clientMutationId: "delete-original",
        type: "highlight.delete",
        createdAt: "2026-01-01T00:00:02.000Z",
      }),
      dependsOnClientMutationIds: [
        "original-create",
        "replacement-create",
      ],
    },
  ];
  const { deps, removed } = recordingDeps(queue, async (mutation) => {
    sent.push(mutation.clientMutationId);
    return { status: mutation.type === "highlight.delete" ? 204 : 201 };
  });

  const result = await flushQueue(deps);

  assert.deepEqual(sent, [
    "original-create",
    "replacement-create",
    "delete-original",
  ]);
  assert.deepEqual(removed, sent);
  assert.equal(result.succeeded, 3);
});
