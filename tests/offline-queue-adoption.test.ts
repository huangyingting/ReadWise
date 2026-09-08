import assert from "node:assert/strict";
import { before, mock, test } from "node:test";

let queueClears = 0;
let articleClears = 0;

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
      countQueuedMutations: async () => 1,
      queuedMutationsBelongTo: async (
        actorId: string,
        purgeGeneration: string,
      ) => actorId === "account-a" && purgeGeneration === "generation-a",
      clearQueuedMutations: async () => {
        queueClears += 1;
        return true;
      },
    },
  });
  mock.module("../src/lib/offline/article-store", {
    namedExports: {
      purgeOfflineData: async () => {
        articleClears += 1;
        return true;
      },
    },
  });
});

test("first rollout preserves queues already bound to the authenticated actor", async () => {
  const storage = new Map<string, string>([
    ["readwise:offline-purge-generation", "generation-a"],
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
  await runtime.setOfflineSyncActor("account-a");

  assert.equal(queueClears, 0);
  assert.equal(articleClears, 1);
  assert.equal(storage.get("readwise:offline-actor-id"), "account-a");
  assert.equal(storage.has("readwise:offline-access-blocked"), false);
  const generation = runtime.captureOfflineMutationGeneration();
  assert.equal(runtime.isOfflineMutationGenerationCurrent(generation), true);
});
