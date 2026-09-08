import assert from "node:assert/strict";
import { before, mock, test } from "node:test";

import type { QueuedMutation } from "@/lib/offline-sync";
import type { EnqueueMutationInput } from "@/lib/offline/mutation-store";

let queue: QueuedMutation[] = [];

before(() => {
  mock.module("../src/lib/offline/mutation-store", {
    namedExports: {
      enqueueMutation: async (input: EnqueueMutationInput) => {
        queue.push({
          clientMutationId: input.clientMutationId,
          type: input.type,
          endpoint: input.endpoint,
          method: input.method,
          payload: input.payload,
          createdAt: new Date().toISOString(),
          purgeGeneration: input.purgeGeneration ?? null,
          retryCount: 0,
          status: "pending",
          lastError: null,
          dedupeKey: input.dedupeKey ?? null,
          dependsOnClientMutationId:
            input.dependsOnClientMutationId ?? null,
          dependsOnClientMutationIds:
            input.dependsOnClientMutationIds ?? null,
        });
        return true;
      },
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
        generation: string | null | undefined,
      ) => {
        const existing = queue.find(
          (mutation) =>
            mutation.clientMutationId === clientMutationId &&
            mutation.purgeGeneration === generation,
        );
        if (!existing) return false;
        queue = queue.filter((mutation) => mutation !== existing);
        return true;
      },
      updateQueuedMutation: async () => undefined,
      countQueuedMutations: async () => queue.length,
      clearQueuedMutations: async () => {
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

test("an obsolete drain cannot delete newly queued current-account mutations", async () => {
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

  const runtime = await import("@/lib/offline/sync-runtime");
  const oldGeneration = runtime.captureOfflineMutationGeneration();
  queue = [
    {
      clientMutationId: "old-today",
      type: "today.read-complete",
      endpoint: "/api/today/read-complete",
      method: "POST",
      payload: { localDate: "2026-09-08", timezone: "UTC" },
      createdAt: "2026-01-01T00:00:00.000Z",
      purgeGeneration: oldGeneration.shared,
      retryCount: 0,
      status: "pending",
      lastError: null,
      dedupeKey: null,
    },
  ];

  let releaseOldRequest!: () => void;
  const oldRequestGate = new Promise<void>((resolve) => {
    releaseOldRequest = resolve;
  });
  const sent: string[] = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url: string) => {
      sent.push(url);
      await oldRequestGate;
      return new Response(null, { status: 200 });
    },
  });

  const oldDrain = runtime.flushOfflineQueue();
  for (let i = 0; sent.length === 0 && i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.deepEqual(sent, ["/api/today/read-complete"]);

  await runtime.purgeOfflineUserData();
  const newGeneration = runtime.captureOfflineMutationGeneration();
  const queued = await runtime.queueMutation({
    type: "highlight.create",
    endpoint: "/api/reader/article-1/highlights",
    method: "POST",
    body: { note: "account B note" },
    clientMutationId: "new-account-highlight",
    generation: newGeneration,
  });
  assert.deepEqual(queued, { sent: false, queued: true });

  releaseOldRequest();
  await oldDrain;

  assert.deepEqual(sent, ["/api/today/read-complete"]);
  assert.deepEqual(
    queue.map((mutation) => mutation.clientMutationId),
    ["new-account-highlight"],
  );
});
