import assert from "node:assert/strict";
import { before, mock, test } from "node:test";

let purgeCalls = 0;

before(() => {
  mock.module("../src/lib/offline/mutation-store", {
    namedExports: {
      enqueueMutation: async () => true,
      discardQueuedMutation: async () => false,
      replaceQueuedMutationPayload: async () => false,
      listQueuedMutations: async () => [],
      removeQueuedMutationForGeneration: async () => false,
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
        return true;
      },
    },
  });
});

test("a fresh same-account tab adopts offline ownership without blocking sibling tabs", async () => {
  const storage = new Map<string, string>([
    ["readwise:offline-actor-id", "account-a"],
    ["readwise:offline-purge-generation", "generation-a"],
  ]);
  const ownershipMutations: string[] = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (
            key === "readwise:offline-actor-id" ||
            key === "readwise:offline-access-blocked"
          ) {
            ownershipMutations.push(`set:${key}:${value}`);
          }
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          if (
            key === "readwise:offline-actor-id" ||
            key === "readwise:offline-access-blocked"
          ) {
            ownershipMutations.push(`remove:${key}`);
          }
          storage.delete(key);
        },
      },
    },
  });

  const runtime = await import("@/lib/offline/sync-runtime");
  await runtime.setOfflineSyncActor("account-a");

  assert.deepEqual(ownershipMutations, []);
  assert.equal(purgeCalls, 0);
  assert.equal(
    runtime.captureOfflineMutationGeneration().actorId,
    "account-a",
  );
});
