import assert from "node:assert/strict";
import { before, mock, test } from "node:test";

import type { QueuedMutation } from "@/lib/offline-sync";

let queue: QueuedMutation[] = [];
let enqueueStarted!: () => void;
let releaseEnqueue!: () => void;

before(() => {
  mock.module("../src/lib/offline/mutation-store", {
    namedExports: {
      enqueueMutation: async (mutation: QueuedMutation) => {
        enqueueStarted();
        await new Promise<void>((resolve) => {
          releaseEnqueue = resolve;
        });
        queue.push(mutation);
        return true;
      },
      discardQueuedMutation: async (clientMutationId: string) => {
        const length = queue.length;
        queue = queue.filter(
          (mutation) => mutation.clientMutationId !== clientMutationId,
        );
        return queue.length !== length;
      },
      replaceQueuedMutationPayload: async () => false,
      listQueuedMutations: async () => queue,
      removeQueuedMutation: async () => undefined,
      removeQueuedMutationForGeneration: async () => false,
      updateQueuedMutation: async () => undefined,
      updateQueuedMutationForGeneration: async () => false,
      countQueuedMutations: async () => queue.length,
      queuedMutationsBelongTo: async () => false,
      clearQueuedMutations: async () => {
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

test("a pre-purge mutation cannot commit a stale fallback after privacy cleanup", async () => {
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
      onLine: false,
      locks: {
        request: async <T>(
          _name: string,
          _options: { mode: "exclusive" },
          callback: () => Promise<T>,
        ): Promise<T> => callback(),
      },
    },
  });

  const runtime = await import("@/lib/offline/sync-runtime");
  storage.set("readwise:offline-actor-id", "account-a");
  await runtime.setOfflineSyncActor("account-a");
  const generation = runtime.captureOfflineMutationGeneration();
  let notifyEnqueueStarted!: () => void;
  const enqueueHasStarted = new Promise<void>((resolve) => {
    notifyEnqueueStarted = resolve;
  });
  enqueueStarted = notifyEnqueueStarted;

  const queueing = runtime.queueMutation({
    type: "highlight.create",
    endpoint: "/api/reader/article-1/highlights",
    method: "POST",
    body: { note: "account A private note" },
    clientMutationId: "late-account-a",
    generation,
  });
  await enqueueHasStarted;

  await runtime.purgeOfflineUserData();
  releaseEnqueue();
  const result = await queueing;

  assert.deepEqual(result, { sent: false, queued: false });
  assert.deepEqual(queue, []);
});
