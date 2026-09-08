import assert from "node:assert/strict";
import { before, mock, test } from "node:test";

let releaseFirstPurge!: () => void;
let purgeCalls = 0;

before(() => {
  mock.module("../src/lib/offline/mutation-store", {
    namedExports: {
      enqueueMutation: async () => true,
      discardQueuedMutation: async () => false,
      replaceQueuedMutationPayload: async () => false,
      listQueuedMutations: async () => [],
      removeQueuedMutation: async () => undefined,
      removeQueuedMutationForGeneration: async () => false,
      updateQueuedMutation: async () => undefined,
      updateQueuedMutationForGeneration: async () => false,
      countQueuedMutations: async () => 0,
      queuedMutationsBelongTo: async () => false,
      clearQueuedMutations: async () => true,
    },
  });
  mock.module("../src/lib/offline/article-store", {
    namedExports: {
      purgeOfflineData: async () => {
        purgeCalls += 1;
        if (purgeCalls === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstPurge = resolve;
          });
        }
        return true;
      },
    },
  });
});

test("overlapping actor transitions cannot persist a stale owner", async () => {
  const storage = new Map<string, string>([
    ["readwise:offline-actor-id", "previous-account"],
  ]);
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
  const first = runtime.setOfflineSyncActor("account-a");
  for (let i = 0; releaseFirstPurge === undefined && i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(typeof releaseFirstPurge, "function");

  const second = runtime.setOfflineSyncActor("account-b");
  releaseFirstPurge();
  await Promise.all([first, second]);

  assert.equal(
    storage.get("readwise:offline-actor-id"),
    "account-b",
  );
  const generation = runtime.captureOfflineMutationGeneration();
  assert.equal(generation.actorId, "account-b");
  assert.equal(runtime.isOfflineMutationGenerationCurrent(generation), true);

  await runtime.setOfflineSyncActor(null);
  assert.equal(
    storage.get("readwise:offline-actor-id"),
    "account-b",
    "a transient unauthenticated session state must not erase offline data",
  );
  assert.equal(purgeCalls, 2);
});
