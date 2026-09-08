import { before, mock, test } from "node:test";
import assert from "node:assert/strict";

before(() => {
  mock.module("../src/lib/offline/mutation-store", {
    namedExports: {
      enqueueMutation: async () => false,
      discardQueuedMutation: async () => false,
      replaceQueuedMutationPayload: async () => false,
      listQueuedMutations: async () => {
        throw new Error("list failed");
      },
      removeQueuedMutation: async () => {},
      removeQueuedMutationForGeneration: async () => false,
      updateQueuedMutation: async () => {},
      updateQueuedMutationForGeneration: async () => false,
      countQueuedMutations: async () => 7,
      queuedMutationsBelongTo: async () => false,
      clearQueuedMutations: async () => {
        throw new Error("clear failed");
      },
    },
  });
  mock.module("../src/lib/offline/article-store", {
    namedExports: {
      purgeOfflineData: async () => {
        throw new Error("purge failed");
      },
    },
  });
});

test("sync runtime falls back when store-backed flush and purge dependencies throw", async () => {
  const runtime = await import("@/lib/offline/sync-runtime");

  const result = await runtime.flushOfflineQueue();
  assert.deepEqual(result, {
    attempted: 0,
    succeeded: 0,
    retried: 0,
    failed: 0,
    remaining: 7,
  });

  await assert.rejects(
    () => runtime.purgeOfflineUserData(),
    /Offline private data could not be cleared/,
  );
  assert.equal(runtime.getSyncState().pending, 0);
});
