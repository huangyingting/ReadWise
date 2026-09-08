import assert from "node:assert/strict";
import { before, mock, test } from "node:test";

import type { QueuedMutation } from "@/lib/offline-sync";

let queue: QueuedMutation[] = [];

before(() => {
  mock.module("../src/lib/offline/mutation-store", {
    namedExports: {
      enqueueMutation: async () => false,
      discardQueuedMutation: async () => false,
      replaceQueuedMutationPayload: async () => false,
      listQueuedMutations: async () => queue,
      removeQueuedMutation: async (clientMutationId: string) => {
        queue = queue.filter(
          (mutation) => mutation.clientMutationId !== clientMutationId,
        );
      },
      removeQueuedMutationForGeneration: async (
        clientMutationId: string,
        purgeGeneration: string | null | undefined,
        actorId: string | undefined,
      ) => {
        const existing = queue.find(
          (mutation) =>
            mutation.clientMutationId === clientMutationId &&
            mutation.purgeGeneration === purgeGeneration &&
            mutation.actorId === actorId,
        );
        if (!existing) return false;
        queue = queue.filter((mutation) => mutation !== existing);
        return true;
      },
      updateQueuedMutation: async () => undefined,
      updateQueuedMutationForGeneration: async () => false,
      countQueuedMutations: async () => queue.length,
      queuedMutationsBelongTo: async () => false,
      clearQueuedMutations: async () => false,
    },
  });
  mock.module("../src/lib/offline/article-store", {
    namedExports: {
      purgeOfflineData: async () => false,
    },
  });
});

test("legacy rows and failed account cleanup cannot replay under another session", async () => {
  const storage = new Map<string, string>([
    ["readwise:offline-actor-id", "account-a"],
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

  const sent: string[] = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url: string) => {
      sent.push(url);
      return new Response(null, { status: 200 });
    },
  });

  const runtime = await import("@/lib/offline/sync-runtime");
  await runtime.setOfflineSyncActor("account-a");

  queue = [
    {
      clientMutationId: "legacy-private-write",
      type: "highlight.create",
      endpoint: "/api/reader/article-1/highlights",
      method: "POST",
      payload: { note: "legacy private note" },
      createdAt: "2026-01-01T00:00:00.000Z",
      retryCount: 0,
      status: "pending",
    },
  ];
  await runtime.flushOfflineQueue();
  assert.deepEqual(sent, []);
  assert.deepEqual(queue, []);

  const generation = runtime.captureOfflineMutationGeneration();
  queue = [
    {
      clientMutationId: "account-a-private-write",
      type: "highlight.create",
      endpoint: "/api/reader/article-1/highlights",
      method: "POST",
      payload: { note: "account A private note" },
      createdAt: "2026-01-01T00:00:01.000Z",
      purgeGeneration: generation.shared,
      actorId: generation.actorId ?? undefined,
      retryCount: 0,
      status: "pending",
    },
  ];

  await assert.rejects(
    () => runtime.setOfflineSyncActor("account-b"),
    /Offline private data could not be cleared/,
  );
  assert.equal(storage.has("readwise:offline-actor-id"), false);
  await runtime.flushOfflineQueue();

  assert.deepEqual(sent, []);
  assert.deepEqual(
    queue.map((mutation) => mutation.clientMutationId),
    ["account-a-private-write"],
  );
});
