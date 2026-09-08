import assert from "node:assert/strict";
import { test } from "node:test";

import {
  flushQueue,
  type FlushDeps,
  type QueuedMutation,
} from "@/lib/offline-sync";
import { withOriginFlushLock } from "@/lib/offline/sync-runtime";

function mutation(
  partial: Partial<QueuedMutation>,
): QueuedMutation {
  return {
    clientMutationId: partial.clientMutationId ?? "mutation",
    type: partial.type ?? "progress",
    endpoint: partial.endpoint ?? "/api/progress",
    method: partial.method ?? "POST",
    payload: partial.payload ?? null,
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    retryCount: 0,
    status: "pending",
    lastError: null,
    dedupeKey: null,
    dependsOnClientMutationId:
      partial.dependsOnClientMutationId ?? null,
  };
}

test("origin-wide flush lock prevents two tabs from replaying one queue concurrently", async () => {
  let lockTail = Promise.resolve();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        request: <T>(
          _name: string,
          _options: { mode: "exclusive" },
          callback: () => Promise<T>,
        ): Promise<T> => {
          const result = lockTail.then(callback);
          lockTail = result.then(
            () => undefined,
            () => undefined,
          );
          return result;
        },
      },
    },
  });

  let queue = [
    mutation({
      clientMutationId: "delete-old",
      type: "highlight.delete",
      endpoint: "/api/highlights/old",
      method: "DELETE",
    }),
    mutation({
      clientMutationId: "create-new",
      type: "highlight.create",
      endpoint: "/api/reader/article-1/highlights",
      payload: { note: "new note" },
      createdAt: "2026-01-01T00:00:01.000Z",
      dependsOnClientMutationId: "delete-old",
    }),
  ];
  let releaseDelete!: () => void;
  const deleteGate = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  const sends: string[] = [];
  let serverNote: string | null = "old note";
  const deps: FlushDeps = {
    list: async () => queue,
    send: async (queued) => {
      sends.push(queued.clientMutationId);
      if (queued.clientMutationId === "delete-old") {
        await deleteGate;
        serverNote = null;
        return { status: 200 };
      }
      serverNote = "new note";
      return { status: 201 };
    },
    remove: async (mutation) => {
      queue = queue.filter(
        (queued) =>
          queued.clientMutationId !== mutation.clientMutationId,
      );
    },
    update: async (mutation, patch) => {
      queue = queue.map((queued) =>
        queued.clientMutationId === mutation.clientMutationId
          ? { ...queued, ...patch }
          : queued,
      );
    },
  };
  const drainAsOneTab = () =>
    withOriginFlushLock(() => flushQueue(deps));

  const firstFlush = drainAsOneTab();
  for (let i = 0; sends.length === 0 && i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.deepEqual(sends, ["delete-old"]);

  const secondFlush = drainAsOneTab();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    sends,
    ["delete-old"],
    "the second tab must wait for the first drain to release the origin lock",
  );

  releaseDelete();
  const [first, second] = await Promise.all([firstFlush, secondFlush]);

  assert.equal(first.succeeded, 2);
  assert.equal(second.attempted, 0);
  assert.deepEqual(sends, ["delete-old", "create-new"]);
  assert.equal(serverNote, "new note");
  assert.deepEqual(queue, []);
});
