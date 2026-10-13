/**
 * Offline sync runtime edge paths: account-transition races, ownership that
 * cannot be persisted, sign-out rollback, and storage/lock failures. The
 * IndexedDB stores are mocked; window, localStorage, and Web Locks are faked.
 */
import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

const ACTOR_KEY = "readwise:offline-actor-id";
const BLOCKED_KEY = "readwise:offline-access-blocked";
const GENERATION_KEY = "readwise:offline-purge-generation";

let storage = new Map<string, string>();
// Keys whose writes fail the way quota or private-mode storage does.
let failingWrites = new Set<string>();
let lockRequests = 0;
let clearSucceeds = true;
let purgeBehavior: "ok" | "fail" | "throw" = "ok";
let replaceCalls: Array<[string, unknown]> = [];

before(() => {
  mock.module("../src/lib/offline/mutation-store", {
    namedExports: {
      enqueueMutation: async () => true,
      discardQueuedMutation: async () => true,
      replaceQueuedMutationPayload: async (id: string, body: unknown) => {
        replaceCalls.push([id, body]);
        return true;
      },
      listQueuedMutations: async () => [],
      removeQueuedMutation: async () => {},
      removeQueuedMutationForGeneration: async () => true,
      updateQueuedMutation: async () => {},
      updateQueuedMutationForGeneration: async () => true,
      countQueuedMutations: async () => 3,
      queuedMutationsBelongTo: async () => false,
      clearQueuedMutations: async () => clearSucceeds,
    },
  });
  mock.module("../src/lib/offline/article-store", {
    namedExports: {
      purgeOfflineData: async () => {
        if (purgeBehavior === "throw") throw new Error("purge threw");
        return purgeBehavior === "ok";
      },
    },
  });
});

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

function installBrowser({ locks }: { locks: boolean }): void {
  defineGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failingWrites.has(key)) throw new Error("QuotaExceededError");
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
  });
  defineGlobal(
    "navigator",
    locks
      ? {
          locks: {
            request: async <T>(_name: string, _options: unknown, work: () => Promise<T>) => {
              lockRequests += 1;
              return work();
            },
          },
        }
      : {},
  );
}

beforeEach(() => {
  storage = new Map();
  failingWrites = new Set();
  lockRequests = 0;
  clearSucceeds = true;
  purgeBehavior = "ok";
  replaceCalls = [];
  installBrowser({ locks: true });
});

test("a superseded account transition stops before claiming ownership", async () => {
  const runtime = await import("@/lib/offline/sync-runtime");

  const first = runtime.setOfflineSyncActor("user-1");
  const second = runtime.setOfflineSyncActor("user-2");
  await Promise.all([first, second]);

  assert.equal(storage.get(ACTOR_KEY), "user-2");
  assert.equal(storage.has(BLOCKED_KEY), false);
  assert.equal(runtime.captureOfflineMutationGeneration().actorId, "user-2");
});

test("an account transition fails when ownership cannot be persisted", async () => {
  const runtime = await import("@/lib/offline/sync-runtime");
  failingWrites.add(ACTOR_KEY);

  await assert.rejects(runtime.setOfflineSyncActor("user-3"), /could not be persisted/);
  assert.equal(
    runtime.isOfflineMutationGenerationCurrent(runtime.captureOfflineMutationGeneration()),
    false,
  );
});

test("account deletion permanently hides retained offline data", async () => {
  const runtime = await import("@/lib/offline/sync-runtime");
  await runtime.setOfflineSyncActor("user-4");
  const generation = runtime.captureOfflineMutationGeneration();
  assert.equal(runtime.isOfflineMutationGenerationCurrent(generation), true);

  runtime.disableOfflineUserDataAccess();

  assert.equal(storage.get(BLOCKED_KEY), "1");
  assert.equal(storage.has(ACTOR_KEY), false);
  assert.equal(runtime.isOfflineMutationGenerationCurrent(generation), false);
  assert.deepEqual(
    await runtime.submitMutation({ type: "progress", endpoint: "/api/progress", generation }),
    { sent: false, queued: false },
  );
});

test("sign-out restores the account when private data cannot be cleared", async () => {
  const runtime = await import("@/lib/offline/sync-runtime");
  await runtime.setOfflineSyncActor("user-5");
  clearSucceeds = false;

  await assert.rejects(runtime.prepareOfflineSignOut(), /could not be cleared/);

  assert.equal(storage.get(ACTOR_KEY), "user-5");
  assert.equal(storage.has(BLOCKED_KEY), false);
});

test("purging serializes through the origin lock when the shared generation cannot be written", async () => {
  const runtime = await import("@/lib/offline/sync-runtime");
  failingWrites.add(GENERATION_KEY);
  purgeBehavior = "throw";

  await assert.rejects(runtime.purgeOfflineUserData(), /could not be cleared/);
  // Once around clearing the stores, once more as a barrier after clearing.
  assert.equal(lockRequests, 2);
  assert.equal(runtime.getSyncState().pending, 0);
});

test("flush falls back to a pending count when origin-wide locking is unavailable", async () => {
  const runtime = await import("@/lib/offline/sync-runtime");
  installBrowser({ locks: false });

  assert.deepEqual(await runtime.flushOfflineQueue(), {
    attempted: 0,
    succeeded: 0,
    retried: 0,
    failed: 0,
    remaining: 3,
  });
  assert.equal(runtime.getSyncState().syncing, false);
});

test("pending mutation bodies are replaced through the durable store", async () => {
  const runtime = await import("@/lib/offline/sync-runtime");

  assert.equal(await runtime.replacePendingMutationBody("m-1", { note: "edited" }), true);
  assert.deepEqual(replaceCalls, [["m-1", { note: "edited" }]]);
});
