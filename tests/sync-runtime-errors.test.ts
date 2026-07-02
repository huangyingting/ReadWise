import { before, mock, test } from "node:test";
import assert from "node:assert/strict";

before(() => {
  mock.module("../src/lib/offline/mutation-store", {
    namedExports: {
      enqueueMutation: async () => {},
      listQueuedMutations: async () => {
        throw new Error("list failed");
      },
      removeQueuedMutation: async () => {},
      updateQueuedMutation: async () => {},
      countQueuedMutations: async () => 7,
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

  await runtime.purgeOfflineUserData();
  assert.equal(runtime.getSyncState().pending, 0);
});
