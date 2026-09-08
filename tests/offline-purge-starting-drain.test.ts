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
      countQueuedMutations: async () => queue.length,
      clearQueuedMutations: async () => {
        clearStarted();
        await new Promise<void>((resolve) => {
          releaseClear = resolve;
        });
        queue = [];
      },
    },
  });
  mock.module("../src/lib/offline/article-store", {
    namedExports: {
      purgeOfflineData: async () => undefined,
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

test("post-clear generation fences a drain that starts during privacy purge", async () => {
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

  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const sent: string[] = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url: string) => {
      sent.push(url);
      if (sent.length === 1) await firstGate;
      return new Response(null, { status: 201 });
    },
  });

  const runtime = await import("@/lib/offline/sync-runtime");
  const purging = runtime.purgeOfflineUserData();
  await clearHasStarted;

  const flushing = runtime.flushOfflineQueue();
  for (let i = 0; sent.length === 0 && i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.deepEqual(sent, ["/api/highlights/first"]);

  releaseClear();
  await purging;
  releaseFirst();
  await flushing;

  assert.deepEqual(
    sent,
    ["/api/highlights/first"],
    "the generation published after clearing must stop the retained snapshot",
  );
  assert.deepEqual(queue, []);
});
