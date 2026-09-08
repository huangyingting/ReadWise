import assert from "node:assert/strict";
import { before, mock, test } from "node:test";

let releaseQueueClear!: () => void;

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
      queuedMutationsBelongTo: async () => true,
      clearQueuedMutations: async () => {
        await new Promise<void>((resolve) => {
          releaseQueueClear = resolve;
        });
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

test("explicit sign-out blocks every new offline write before clearing", async () => {
  const storage = new Map<string, string>([
    ["readwise:offline-actor-id", "account-a"],
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

  const signingOut = runtime.prepareOfflineSignOut();
  assert.equal(storage.get("readwise:offline-access-blocked"), "1");
  assert.equal(storage.has("readwise:offline-actor-id"), false);
  assert.deepEqual(
    await runtime.queueMutation({
      type: "highlight.create",
      endpoint: "/api/reader/a1/highlights",
      body: { note: "must not survive logout" },
    }),
    { sent: false, queued: false },
  );

  for (let i = 0; releaseQueueClear === undefined && i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(typeof releaseQueueClear, "function");
  releaseQueueClear();
  await signingOut;

  await runtime.setOfflineSyncActor(null);
  assert.equal(storage.get("readwise:offline-access-blocked"), "1");
  assert.equal(storage.has("readwise:offline-actor-id"), false);
});
