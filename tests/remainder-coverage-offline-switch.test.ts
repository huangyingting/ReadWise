import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import type { QueuedMutation } from "@/lib/offline-sync";

type StoreName = "articles" | "mutations";

type RequestHandlers<T> = {
  onsuccess: ((event: { target: FakeRequest<T> }) => void) | null;
  onerror: (() => void) | null;
};

class FakeRequest<T> implements RequestHandlers<T> {
  result!: T;
  error: unknown = null;
  onsuccess: ((event: { target: FakeRequest<T> }) => void) | null = null;
  onerror: (() => void) | null = null;

  succeed(result: T): this {
    queueMicrotask(() => {
      this.result = result;
      this.onsuccess?.({ target: this });
    });
    return this;
  }

  fail(error: unknown): this {
    queueMicrotask(() => {
      this.error = error;
      this.onerror?.();
    });
    return this;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: unknown = null;
  private completeScheduled = false;
  private readonly db: FakeDb;

  constructor(db: FakeDb) {
    this.db = db;
  }

  objectStore(name: StoreName): FakeObjectStore {
    return new FakeObjectStore(this.db, name, this);
  }

  scheduleComplete(): void {
    if (this.completeScheduled) return;
    this.completeScheduled = true;
    queueMicrotask(() => this.oncomplete?.());
  }
}

class FakeCursor {
  private readonly request: FakeRequest<FakeCursor | null>;
  private readonly records: Array<{ key: string; value: Record<string, unknown> }>;
  private index: number;
  readonly value: Record<string, unknown>;
  private readonly deleteRecord: (key: string) => void;

  constructor(
    request: FakeRequest<FakeCursor | null>,
    records: Array<{ key: string; value: Record<string, unknown> }>,
    index: number,
    value: Record<string, unknown>,
    deleteRecord: (key: string) => void,
  ) {
    this.request = request;
    this.records = records;
    this.index = index;
    this.value = value;
    this.deleteRecord = deleteRecord;
  }

  delete(): void {
    this.deleteRecord(this.records[this.index].key);
  }

  continue(): void {
    const nextIndex = this.index + 1;
    const next = this.records[nextIndex];
    this.request.succeed(
      next
        ? new FakeCursor(
            this.request,
            this.records,
            nextIndex,
            next.value,
            this.deleteRecord,
          )
        : null,
    );
  }
}

class FakeIndex {
  private readonly db: FakeDb;
  private readonly storeName: StoreName;
  private readonly indexName: string;

  constructor(
    db: FakeDb,
    storeName: StoreName,
    indexName: string,
  ) {
    this.db = db;
    this.storeName = storeName;
    this.indexName = indexName;
  }

  openCursor(range?: { only?: unknown }): FakeRequest<FakeCursor | null> {
    const rows = [...this.db.store(this.storeName).entries()]
      .map(([key, value]) => ({ key, value }))
      .filter(({ value }) => range?.only === undefined || value[this.indexName] === range.only)
      .sort((a, b) => String(a.value[this.indexName] ?? "").localeCompare(String(b.value[this.indexName] ?? "")));
    const req = new FakeRequest<FakeCursor | null>();
    const first = rows[0];
    return req.succeed(
      first
        ? new FakeCursor(req, rows, 0, first.value, (key) => {
            this.db.store(this.storeName).delete(key);
          })
        : null,
    );
  }
}

class FakeObjectStore {
  private readonly db: FakeDb;
  private readonly name: StoreName;
  private readonly tx?: FakeTransaction;

  constructor(
    db: FakeDb,
    name: StoreName,
    tx?: FakeTransaction,
  ) {
    this.db = db;
    this.name = name;
    this.tx = tx;
  }

  createIndex(name: string): void {
    this.db.indexes(this.name).add(name);
  }

  index(name: string): FakeIndex {
    return new FakeIndex(this.db, this.name, name);
  }

  count(): FakeRequest<number> {
    return new FakeRequest<number>().succeed(this.db.store(this.name).size);
  }

  get(key: string): FakeRequest<Record<string, unknown> | undefined> {
    return new FakeRequest<Record<string, unknown> | undefined>().succeed(
      this.db.store(this.name).get(key),
    );
  }

  getAll(): FakeRequest<Record<string, unknown>[]> {
    return new FakeRequest<Record<string, unknown>[]>().succeed([
      ...this.db.store(this.name).values(),
    ]);
  }

  put(value: Record<string, unknown>): void {
    const keyPath = this.name === "articles" ? "id" : "clientMutationId";
    this.db.store(this.name).set(String(value[keyPath]), { ...value });
    this.tx?.scheduleComplete();
  }

  delete(key: string): void {
    this.db.store(this.name).delete(key);
    this.tx?.scheduleComplete();
  }

  clear(): void {
    this.db.store(this.name).clear();
    this.tx?.scheduleComplete();
  }
}

class FakeDb {
  readonly stores = new Map<StoreName, Map<string, Record<string, unknown>>>();
  readonly storeIndexes = new Map<StoreName, Set<string>>();
  readonly objectStoreNames = {
    contains: (name: string) => this.stores.has(name as StoreName),
  };

  createObjectStore(name: StoreName): FakeObjectStore {
    this.stores.set(name, new Map());
    this.storeIndexes.set(name, new Set());
    return new FakeObjectStore(this, name);
  }

  transaction(name: StoreName): FakeTransaction {
    this.store(name);
    return new FakeTransaction(this);
  }

  store(name: StoreName): Map<string, Record<string, unknown>> {
    let store = this.stores.get(name);
    if (!store) {
      store = new Map();
      this.stores.set(name, store);
    }
    return store;
  }

  indexes(name: StoreName): Set<string> {
    let indexes = this.storeIndexes.get(name);
    if (!indexes) {
      indexes = new Set();
      this.storeIndexes.set(name, indexes);
    }
    return indexes;
  }

  close(): void {}
}

class FakeIndexedDb {
  db = new FakeDb();
  openThrows = false;
  openFails = false;
  deleteThrows = false;
  deleted = false;

  open(_name: string, _version: number): FakeRequest<FakeDb> {
    if (this.openThrows) throw new Error("open threw");
    const req = new FakeRequest<FakeDb>();
    if (this.openFails) return req.fail(new Error("open failed"));
    queueMicrotask(() => {
      if (!this.db.objectStoreNames.contains("articles") || !this.db.objectStoreNames.contains("mutations")) {
        (req as FakeRequest<FakeDb> & { onupgradeneeded?: (event: { target: FakeRequest<FakeDb> }) => void }).result = this.db;
        (req as FakeRequest<FakeDb> & { onupgradeneeded?: (event: { target: FakeRequest<FakeDb> }) => void }).onupgradeneeded?.({ target: req });
      }
      req.result = this.db;
      req.onsuccess?.({ target: req });
    });
    return req;
  }

  deleteDatabase(_name: string): FakeRequest<undefined> {
    if (this.deleteThrows) throw new Error("delete threw");
    this.db = new FakeDb();
    this.deleted = true;
    return new FakeRequest<undefined>().succeed(undefined);
  }
}

let fakeIndexedDb: FakeIndexedDb;

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

function installIndexedDb(): FakeIndexedDb {
  fakeIndexedDb = new FakeIndexedDb();
  defineGlobal("window", {});
  defineGlobal("indexedDB", fakeIndexedDb);
  defineGlobal("IDBKeyRange", { only: (only: unknown) => ({ only }) });
  return fakeIndexedDb;
}

function makeNavigator(value: Record<string, unknown>): void {
  defineGlobal("navigator", value);
}

function makeArticle(id: string, savedAt?: string): Record<string, unknown> {
  return {
    id,
    title: `Title ${id}`,
    sanitizedHtml: "<p>safe</p>",
    author: null,
    source: null,
    sourceUrl: `https://example.test/${id}`,
    heroImage: null,
    difficulty: "B1",
    readingMinutes: 3,
    publishedAt: null,
    version: `v-${id}`,
    contentHash: `h-${id}`,
    savedAt: savedAt ?? new Date().toISOString(),
  };
}

function queued(partial: Partial<QueuedMutation> = {}): QueuedMutation {
  return {
    clientMutationId: partial.clientMutationId ?? "m1",
    type: partial.type ?? "progress",
    endpoint: partial.endpoint ?? "/api/progress",
    method: partial.method ?? "POST",
    payload: partial.payload ?? { percent: 10 },
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    retryCount: partial.retryCount ?? 0,
    status: partial.status ?? "pending",
    lastError: partial.lastError ?? null,
    dedupeKey: partial.dedupeKey ?? null,
  };
}

beforeEach(() => {
  installIndexedDb();
  defineGlobal("crypto", { randomUUID: () => "uuid-from-crypto" });
});

test("idb helper reports availability and upgrades article/mutation stores", async () => {
  const { isIndexedDbAvailable, openDb, STORE_ARTICLES, STORE_MUTATIONS } =
    await import("@/lib/offline/idb");

  delete (globalThis as Record<string, unknown>).window;
  assert.equal(isIndexedDbAvailable(), false);
  defineGlobal("window", {});
  assert.equal(isIndexedDbAvailable(), true);

  const db = await openDb();
  assert.equal(db.objectStoreNames.contains(STORE_ARTICLES), true);
  assert.equal(db.objectStoreNames.contains(STORE_MUTATIONS), true);
  assert.ok(fakeIndexedDb.db.indexes(STORE_ARTICLES).has("savedAt"));
  assert.ok(fakeIndexedDb.db.indexes(STORE_MUTATIONS).has("dedupeKey"));

  fakeIndexedDb.openFails = true;
  await assert.rejects(() => openDb(), /open failed/);
});

test("offline article store saves, expires, lists, evicts, removes, and purges", async () => {
  const {
    MAX_OFFLINE_ARTICLES,
    getAllOfflineArticles,
    getOfflineArticle,
    getOfflineArticleVersion,
    isArticleOffline,
    purgeOfflineData,
    removeOfflineArticle,
    saveOfflineArticle,
  } = await import("@/lib/offline/article-store");

  await saveOfflineArticle(makeArticle("a1") as never);
  assert.equal((await getOfflineArticle("a1"))?.title, "Title a1");
  assert.equal(await getOfflineArticleVersion("a1"), "v-a1");
  assert.equal(await isArticleOffline("a1"), true);

  fakeIndexedDb.db.store("articles").set(
    "expired",
    makeArticle("expired", "2020-01-01T00:00:00.000Z"),
  );
  assert.equal(await getOfflineArticle("expired"), null);

  fakeIndexedDb.db.store("articles").set(
    "older",
    makeArticle("older", new Date(Date.now() - 2_000).toISOString()),
  );
  fakeIndexedDb.db.store("articles").set(
    "newer",
    makeArticle("newer", new Date(Date.now() - 1_000).toISOString()),
  );
  const all = await getAllOfflineArticles();
  const ids = all.map((article) => article.id);
  assert.ok(ids.indexOf("newer") < ids.indexOf("older"));
  assert.ok(all.every((article) => article.id !== "expired"));

  await removeOfflineArticle("a1");
  assert.equal(await isArticleOffline("a1"), false);

  for (let i = 0; i <= MAX_OFFLINE_ARTICLES; i++) {
    await saveOfflineArticle(makeArticle(`bulk-${i}`) as never);
  }
  assert.ok(fakeIndexedDb.db.store("articles").size <= MAX_OFFLINE_ARTICLES);

  await purgeOfflineData();
  assert.equal(fakeIndexedDb.deleted, true);

  fakeIndexedDb.deleteThrows = true;
  await purgeOfflineData();

  fakeIndexedDb.deleteThrows = false;
  fakeIndexedDb.openThrows = true;
  await saveOfflineArticle(makeArticle("catch-save") as never);
  assert.equal(await getOfflineArticle("catch-get"), null);
  assert.deepEqual(await getAllOfflineArticles(), []);
  await removeOfflineArticle("catch-remove");
});

test("offline mutation store dedupes, updates, removes, clears, and degrades gracefully", async () => {
  const {
    clearQueuedMutations,
    countQueuedMutations,
    enqueueMutation,
    listQueuedMutations,
    removeQueuedMutation,
    updateQueuedMutation,
  } = await import("@/lib/offline/mutation-store");

  await enqueueMutation({
    clientMutationId: "m1",
    type: "progress",
    endpoint: "/api/progress",
    method: "POST",
    payload: { percent: 10 },
    dedupeKey: "progress:a1",
  });
  await enqueueMutation({
    clientMutationId: "m2",
    type: "progress",
    endpoint: "/api/progress",
    method: "POST",
    payload: { percent: 20 },
    dedupeKey: "progress:a1",
  });

  assert.equal(await countQueuedMutations(), 1);
  assert.deepEqual((await listQueuedMutations()).map((m) => m.clientMutationId), ["m2"]);

  await updateQueuedMutation("m2", { status: "failed", retryCount: 3, lastError: "bad" });
  assert.equal((await listQueuedMutations())[0].status, "failed");

  await removeQueuedMutation("m2");
  assert.equal(await countQueuedMutations(), 0);

  await enqueueMutation({
    clientMutationId: "m3",
    type: "quiz.attempt",
    endpoint: "/api/quiz",
    method: "POST",
    payload: { score: 1 },
  });
  await clearQueuedMutations();
  assert.deepEqual(await listQueuedMutations(), []);

  delete (globalThis as Record<string, unknown>).window;
  assert.equal(await countQueuedMutations(), 0);
  assert.deepEqual(await listQueuedMutations(), []);
  await enqueueMutation({ clientMutationId: "off", type: "x", endpoint: "x", method: "POST", payload: null });

  defineGlobal("window", {});
  fakeIndexedDb.openThrows = true;
  assert.equal(await countQueuedMutations(), 0);
  assert.deepEqual(await listQueuedMutations(), []);
  await updateQueuedMutation("missing", { status: "failed" });
  await removeQueuedMutation("missing");
  await clearQueuedMutations();
});

test("offline conflict helpers cover empty anchors and one-sided note merges", async () => {
  const { mergeNoteConflict, revalidateAnchor } = await import("@/lib/offline-conflict");

  assert.deepEqual(
    revalidateAnchor({ quote: "", startOffset: 0, endOffset: 0 }, "plain text"),
    { status: "missing", stale: true },
  );
  assert.deepEqual(mergeNoteConflict("", "client edit", "base"), {
    text: "client edit",
    conflict: false,
  });
  assert.deepEqual(mergeNoteConflict("server edit", "", "base"), {
    text: "server edit",
    conflict: false,
  });
});

test("sync runtime submits mutations, updates subscribers, flushes queues, and purges device data", async () => {
  const store = await import("@/lib/offline/mutation-store");
  const runtime = await import("@/lib/offline/sync-runtime");
  const { STORAGE_KEYS } = await import("@/lib/storage-keys");

  const fetches: Array<{ url: string; init: RequestInit }> = [];
  let nextStatus = 201;
  defineGlobal("fetch", async (url: string, init: RequestInit) => {
    fetches.push({ url, init });
    return new Response(null, { status: nextStatus });
  });

  const syncRegistrations: string[] = [];
  const postedMessages: unknown[] = [];
  const windowListeners = new Map<string, () => void>();
  const swListeners = new Map<string, (event: MessageEvent) => void>();
  defineGlobal("window", {
    addEventListener: (type: string, cb: () => void) => windowListeners.set(type, cb),
  });
  makeNavigator({
    onLine: true,
    serviceWorker: {
      ready: Promise.resolve({
        sync: { register: async (tag: string) => syncRegistrations.push(tag) },
        active: { postMessage: (msg: unknown) => postedMessages.push(msg) },
      }),
      addEventListener: (type: string, cb: (event: MessageEvent) => void) => swListeners.set(type, cb),
    },
  });

  assert.equal(runtime.newClientMutationId(), "uuid-from-crypto");
  defineGlobal("crypto", {});
  assert.match(runtime.newClientMutationId(), /^m_/);

  const seenStates: number[] = [];
  const unsubscribe = runtime.subscribeSyncState((state) => seenStates.push(state.pending));
  assert.equal(runtime.getSyncState().pending, 0);

  const sent = await runtime.submitMutation({
    type: "progress",
    endpoint: "/api/progress",
    body: { percent: 42 },
    clientMutationId: "online-ok",
  });
  assert.deepEqual(sent, { sent: true, queued: false, status: 201 });
  assert.equal(
    (fetches[0].init.headers as Record<string, string>)[runtime.MUTATION_HEADER],
    "online-ok",
  );
  assert.equal(fetches[0].init.body, JSON.stringify({ percent: 42 }));

  nextStatus = 400;
  assert.deepEqual(
    await runtime.submitMutation({
      type: "progress",
      endpoint: "/api/progress",
      clientMutationId: "bad-request",
    }),
    { sent: false, queued: false, status: 400 },
  );

  nextStatus = 503;
  const queuedOnTransient = await runtime.submitMutation({
    type: "progress",
    endpoint: "/api/progress",
    method: "DELETE",
    body: { ignored: true },
    clientMutationId: "retry-later",
  });
  assert.deepEqual(queuedOnTransient, { sent: false, queued: true });
  assert.ok(syncRegistrations.includes(runtime.SYNC_TAG));
  assert.equal(fetches.at(-1)?.init.body, undefined);

  defineGlobal("fetch", async () => {
    throw new Error("network down");
  });
  makeNavigator({
    onLine: true,
    serviceWorker: {
      ready: Promise.resolve({
        sync: {
          register: async () => {
            throw new Error("sync unsupported");
          },
        },
      }),
    },
  });
  assert.deepEqual(
    await runtime.submitMutation({
      type: "progress",
      endpoint: "/api/progress",
      clientMutationId: "network-error",
    }),
    { sent: false, queued: true },
  );

  makeNavigator({ onLine: false });
  assert.deepEqual(
    await runtime.submitMutation({
      type: "progress",
      endpoint: "/api/progress",
      clientMutationId: "offline",
    }),
    { sent: false, queued: true },
  );
  assert.ok(seenStates.some((pending) => pending > 0));
  unsubscribe();

  await store.clearQueuedMutations();
  const conflicts: unknown[] = [];
  const unsubscribeConflicts = runtime.subscribeTodayConflicts((info) => conflicts.push(info));
  unsubscribeConflicts();
  runtime.subscribeTodayConflicts((info) => conflicts.push(info));
  await store.enqueueMutation(
    queued({
      clientMutationId: "today-conflict",
      type: "today.skip",
      endpoint: "/api/today/skip",
      payload: { localDate: "2026-06-27", timezone: "UTC", skipReason: "busy" },
    }),
  );
  await store.enqueueMutation(
    queued({
      clientMutationId: "generic-ok",
      type: "progress",
      endpoint: "/api/progress",
      payload: { percent: 90 },
      createdAt: "2026-06-28T00:00:00.000Z",
    }),
  );
  makeNavigator({ onLine: true });
  nextStatus = 409;
  defineGlobal("fetch", async (url: string, init: RequestInit) => {
    fetches.push({ url, init });
    return new Response(null, {
      status: String(url).includes("/api/today/skip") ? 409 : 200,
    });
  });
  const result = await runtime.flushOfflineQueue();
  assert.equal(result.succeeded, 1);
  assert.ok(conflicts.some((info) => (info as { mutationType: string }).mutationType === "today.skip"));
  assert.equal((await store.listQueuedMutations()).some((m) => m.status === "conflict"), true);

  await runtime.flushOfflineQueue();

  let releaseFetch!: () => void;
  defineGlobal("fetch", async () => {
    await new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    return new Response(null, { status: 200 });
  });
  await store.enqueueMutation(queued({ clientMutationId: "slow", endpoint: "/api/slow" }));
  const firstFlush = runtime.flushOfflineQueue();
  const secondFlush = runtime.flushOfflineQueue();
  for (let i = 0; releaseFetch === undefined && i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(typeof releaseFetch, "function");
  releaseFetch();
  await Promise.all([firstFlush, secondFlush]);

  makeNavigator({
    onLine: true,
    serviceWorker: {
      ready: Promise.resolve({
        sync: { register: async (tag: string) => syncRegistrations.push(tag) },
        active: { postMessage: (msg: unknown) => postedMessages.push(msg) },
      }),
      addEventListener: (type: string, cb: (event: MessageEvent) => void) => swListeners.set(type, cb),
    },
  });
  runtime.registerOfflineSync();
  runtime.registerOfflineSync();
  assert.ok(windowListeners.has("online"));
  assert.ok(swListeners.has("message"));
  windowListeners.get("online")?.();
  swListeners.get("message")?.({ data: { type: STORAGE_KEYS.SW_FLUSH_QUEUE } } as MessageEvent);
  swListeners.get("message")?.({ data: { type: "ignored" } } as MessageEvent);

  await runtime.purgeOfflineUserData();
  assert.deepEqual(postedMessages, [{ type: STORAGE_KEYS.SW_PURGE_CACHES }]);
  assert.equal(runtime.getSyncState().pending, 0);

  makeNavigator({
    serviceWorker: {
      ready: Promise.reject(new Error("no service worker")),
    },
  });
  await runtime.purgeOfflineUserData();
});
