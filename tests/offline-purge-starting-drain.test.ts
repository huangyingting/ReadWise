import assert from "node:assert/strict";
import { before, mock, test } from "node:test";

import type { QueuedMutation } from "@/lib/offline-sync";

let queue: QueuedMutation[] = [];
let releaseClear!: () => void;
let clearStarted!: () => void;

before(() => {
  mock.module("../src/lib/offline/mutation-store", {
    namedExports: {
      enqueueMutation: async () => true,
      discardQueuedMutation: async () => false,
      replaceQueuedMutationPayload: async () => false,
      listQueuedMutations: async () => queue,
      removeQueuedMutation: async (clientMutationId: string) => {
        queue = queue.filter(
          (mutation) => mutation.clientMutationId !== clientMutationId,
        );
      },
      removeQueuedMutationForGeneration: async () => false,
      updateQueuedMutation: async () => undefined,
      updateQueuedMutationForGeneration: async () => false,
      countQueuedMutations: async () => queue.length,
      queuedMutationsBelongTo: async () => false,
      clearQueuedMutations: async () => {
        clearStarted();
        await new Promise<void>((resolve) => {
          releaseClear = resolve;
        });
        queue = [];
        return true;
      },
    },
  });
  mock.module("../src/lib/offline/article-store", {
    namedExports: {
      purgeOfflineData: async () => true,
    },
  });
});

function legacyQueued(
  clientMutationId: string,
  createdAt: string,
): QueuedMutation {
  return {
    clientMutationId,
    type: "highlight.create",
    endpoint: `/api/highlights/${clientMutationId}`,
    method: "POST",
    payload: { note: `${clientMutationId} private note` },
    createdAt,
    retryCount: 0,
    status: "pending",
    lastError: null,
    dedupeKey: null,
  };
}

test("unversioned records are never replayed while privacy purge is clearing", async () => {
  queue = [
    legacyQueued("first", "2026-01-01T00:00:00.000Z"),
    legacyQueued("second", "2026-01-01T00:00:01.000Z"),
  ];
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      onLine: true,
      locks: {
        request: async <T>(
          _name: string,
          _options: { mode: "exclusive" },
          callback: () => Promise<T>,
        ): Promise<T> => callback(),
      },
    },
  });

  let notifyClearStarted!: () => void;
  const clearHasStarted = new Promise<void>((resolve) => {
    notifyClearStarted = resolve;
  });
  clearStarted = notifyClearStarted;

  const sent: string[] = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url: string) => {
      sent.push(url);
      return new Response(null, { status: 201 });
    },
  });

  const runtime = await import("@/lib/offline/sync-runtime");
  storage.set("readwise:offline-actor-id", "account-a");
  await runtime.setOfflineSyncActor("account-a");
  const purging = runtime.purgeOfflineUserData();
  await clearHasStarted;

  const flushing = runtime.flushOfflineQueue();
  await flushing;
  assert.deepEqual(sent, []);

  releaseClear();
  await purging;
  assert.deepEqual(queue, []);
});
