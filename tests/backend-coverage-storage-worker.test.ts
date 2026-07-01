process.env.LOG_LEVEL = "error";

import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

function setWindow(localStorage: unknown, sessionStorage: unknown = localStorage) {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage, sessionStorage },
    configurable: true,
  });
}

test("storage key helpers hash, normalize extensions, and sanitize hints", async () => {
  const {
    extensionForMime,
    normalizeExtension,
    sanitizeKeyHint,
    sha256Hex,
  } = await import("@/lib/storage/key");

  assert.equal(sha256Hex(Buffer.from("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(extensionForMime("audio/mpeg"), ".mp3");
  assert.equal(extensionForMime("audio/MP3"), ".mp3");
  assert.equal(extensionForMime("audio/ogg"), ".ogg");
  assert.equal(extensionForMime("audio/opus"), ".ogg");
  assert.equal(extensionForMime("audio/wav"), ".wav");
  assert.equal(extensionForMime("audio/x-wav"), ".wav");
  assert.equal(extensionForMime("audio/webm"), ".webm");
  assert.equal(extensionForMime("application/octet-stream"), ".bin");

  assert.equal(normalizeExtension(undefined), null);
  assert.equal(normalizeExtension("   "), null);
  assert.equal(normalizeExtension("MP3"), ".mp3");
  assert.equal(normalizeExtension(" .Ogg!? "), ".ogg");
  assert.equal(sanitizeKeyHint(undefined), "media");
  assert.equal(sanitizeKeyHint("/Speech//../Unsafe Key!"), "speech/-/unsafe-key-");
  assert.equal(sanitizeKeyHint("..."), "-");
  assert.equal(sanitizeKeyHint("////"), "media");
});

test("provider registry returns only registered non-database providers", async () => {
  const { registerProvider, resolveProvider } = await import("@/lib/storage/registry");
  const provider = { kind: "filesystem" } as never;

  assert.equal(resolveProvider("database"), null);
  assert.equal(resolveProvider("azure"), null);
  registerProvider("filesystem", () => provider);
  assert.equal(resolveProvider("filesystem"), provider);
  registerProvider("filesystem", () => null);
  assert.equal(resolveProvider("filesystem"), null);
});

test("browser storage helpers tolerate SSR, working storage, and storage failures", async () => {
  const {
    lsGet,
    lsRemove,
    lsSet,
    ssGet,
    ssRemove,
    ssSet,
  } = await import("@/lib/storage-keys");

  assert.equal(lsGet("missing"), null);
  assert.doesNotThrow(() => lsSet("k", "v"));
  assert.doesNotThrow(() => lsRemove("k"));
  assert.equal(ssGet("missing"), null);
  assert.doesNotThrow(() => ssSet("k", "v"));
  assert.doesNotThrow(() => ssRemove("k"));

  const local = new MemoryStorage();
  const session = new MemoryStorage();
  setWindow(local, session);
  lsSet("local-key", "local-value");
  ssSet("session-key", "session-value");
  assert.equal(lsGet("local-key"), "local-value");
  assert.equal(ssGet("session-key"), "session-value");
  lsRemove("local-key");
  ssRemove("session-key");
  assert.equal(lsGet("local-key"), null);
  assert.equal(ssGet("session-key"), null);

  const throwingStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  setWindow(throwingStorage);
  assert.equal(lsGet("k"), null);
  assert.equal(ssGet("k"), null);
  assert.doesNotThrow(() => lsSet("k", "v"));
  assert.doesNotThrow(() => ssSet("k", "v"));
  assert.doesNotThrow(() => lsRemove("k"));
  assert.doesNotThrow(() => ssRemove("k"));
});

test("sleep resolves, rejects on abort, and identifies AbortError instances", async () => {
  const { AbortError, isAbort, sleep } = await import("@/lib/worker/sleep");

  await sleep(1);
  assert.equal(isAbort(new AbortError()), true);
  assert.equal(isAbort(new Error("other")), false);

  const preAborted = new AbortController();
  preAborted.abort();
  await assert.rejects(() => sleep(1, preAborted.signal), { name: "AbortError" });

  const controller = new AbortController();
  const promise = sleep(50, controller.signal);
  controller.abort();
  await assert.rejects(() => promise, { name: "AbortError" });
});

test("ttl cache expires entries, refreshes LRU position, and supports factory helpers", async () => {
  const { TtlCache, createTtlCache } = await import("@/lib/primitives/ttl-cache");

  const cache = new TtlCache<string, number>({ ttlMs: 10, maxSize: 2 });
  assert.equal(cache.get("missing", 0), undefined);
  cache.set("a", 1, 0);
  assert.equal(cache.get("a", 5), 1);
  assert.equal(cache.get("a", 10), undefined);
  assert.equal(cache.size, 0);

  cache.set("a", 1, 20);
  cache.set("b", 2, 20);
  cache.set("a", 3, 21);
  cache.set("c", 4, 22);
  assert.equal(cache.get("a", 23), 3);
  assert.equal(cache.get("b", 23), undefined);
  assert.equal(cache.delete("a"), true);
  assert.equal(cache.delete("a"), false);
  cache.clear();
  assert.equal(cache.size, 0);

  const made = createTtlCache<string, string>({ ttlMs: 5 });
  made.set("k", "v", 0);
  assert.equal(made.get("k", 1), "v");
});

test("E2E database guard accepts only the configured isolated SQLite database", async () => {
  const {
    assertSafeE2eDatabaseUrl,
    expectedE2eDatabaseUrl,
  } = await import("@/lib/testing/db-guard");

  const previous = process.env.PLAYWRIGHT_DATABASE_URL;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  try {
    delete process.env.PLAYWRIGHT_DATABASE_URL;
    delete process.env.DATABASE_URL;
    assert.equal(expectedE2eDatabaseUrl(), "file:./e2e.db");
    assert.doesNotThrow(() =>
      assertSafeE2eDatabaseUrl({
        databaseUrl: "file:./e2e.db",
        expectedDatabaseUrl: "file:./e2e.db",
      }),
    );
    assert.doesNotThrow(() =>
      assertSafeE2eDatabaseUrl({
        databaseUrl: "file:./nested/e2e-tenant_1.db?connection_limit=1",
        expectedDatabaseUrl: "file:./nested/e2e-tenant_1.db?connection_limit=1",
      }),
    );

    assert.throws(() => assertSafeE2eDatabaseUrl({ databaseUrl: undefined }), /not set/);
    assert.throws(
      () =>
        assertSafeE2eDatabaseUrl({
          databaseUrl: "file:./dev.db",
          expectedDatabaseUrl: "file:./e2e.db",
        }),
      /does not match/,
    );
    assert.throws(
      () =>
        assertSafeE2eDatabaseUrl({
          databaseUrl: "postgres://localhost/db",
          expectedDatabaseUrl: "postgres://localhost/db",
        }),
      /isolated e2e/,
    );
    assert.throws(
      () =>
        assertSafeE2eDatabaseUrl({
          databaseUrl: "file:",
          expectedDatabaseUrl: "file:",
        }),
      /isolated e2e/,
    );
    assert.throws(
      () =>
        assertSafeE2eDatabaseUrl({
          databaseUrl: "file:./not-e2e.db",
          expectedDatabaseUrl: "file:./not-e2e.db",
        }),
      /isolated e2e/,
    );

    process.env.PLAYWRIGHT_DATABASE_URL = "file:./e2e.custom.db";
    assert.equal(expectedE2eDatabaseUrl(), "file:./e2e.custom.db");
  } finally {
    if (previous === undefined) delete process.env.PLAYWRIGHT_DATABASE_URL;
    else process.env.PLAYWRIGHT_DATABASE_URL = previous;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test("push request schemas accept valid objects and reject non-object bodies", async () => {
  const { rawObjectBody, subscribeBody, unsubscribeBody } = await import("@/lib/push/schemas");

  assert.equal(rawObjectBody(null).ok, false);
  assert.equal(rawObjectBody([]).ok, false);
  assert.deepEqual(rawObjectBody({ reminders: null }), {
    ok: true,
    value: { reminders: null },
  });
  assert.equal(subscribeBody({ endpoint: "https://push.example/sub", p256dh: "p", auth: "a" }).ok, true);
  assert.equal(unsubscribeBody({ endpoint: "https://push.example/sub" }).ok, true);
});
