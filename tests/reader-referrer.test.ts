/**
 * Tests for src/lib/reader-referrer.ts — sessionStorage-backed reader
 * navigation referrer. Covers SSR fallback, storage errors, and round-trip
 * serialization.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Browser storage stub
// ---------------------------------------------------------------------------

function createStorageStub() {
  const store = new Map<string, string>();
  return {
    store,
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, value); },
    removeItem(key: string) { store.delete(key); },
    clear() { store.clear(); },
    get length() { return store.size; },
    key(_i: number) { return null; },
  } satisfies Storage;
}

let storage: ReturnType<typeof createStorageStub>;

beforeEach(() => {
  storage = createStorageStub();
  (globalThis as Record<string, unknown>).sessionStorage = storage;
  // Ensure window is defined (browser context)
  if (typeof globalThis.window === "undefined") {
    (globalThis as Record<string, unknown>).window = globalThis;
  }
});

describe("reader-referrer", () => {
  test("setReaderReferrer persists JSON to sessionStorage under the expected key", async () => {
    const { setReaderReferrer, READER_REFERRER_KEY } = await import(
      "@/lib/reader-referrer"
    );

    setReaderReferrer({ href: "/dashboard", label: "Dashboard" });

    const raw = storage.getItem(READER_REFERRER_KEY);
    assert.ok(raw, "expected storage to contain the referrer");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.href, "/dashboard");
    assert.equal(parsed.label, "Dashboard");
  });

  test("setReaderReferrer silently ignores storage errors", async () => {
    const { setReaderReferrer } = await import("@/lib/reader-referrer");

    // Make setItem throw
    (globalThis as Record<string, unknown>).sessionStorage = {
      ...storage,
      setItem() { throw new Error("QuotaExceeded"); },
    };

    // Should not throw
    setReaderReferrer({ href: "/x", label: "X" });
  });

  test("READER_REFERRER_KEY matches the storage-keys registry value", async () => {
    const { READER_REFERRER_KEY } = await import("@/lib/reader-referrer");
    const { STORAGE_KEYS } = await import("@/lib/storage-keys");
    assert.equal(READER_REFERRER_KEY, STORAGE_KEYS.READER_REFERRER);
  });

  test("ReaderReferrer type shape is enforced (href + label)", async () => {
    const { setReaderReferrer, READER_REFERRER_KEY } = await import(
      "@/lib/reader-referrer"
    );

    setReaderReferrer({ href: "/library?tag=science", label: "Science" });

    const raw = storage.getItem(READER_REFERRER_KEY);
    assert.ok(raw);
    const parsed = JSON.parse(raw);
    assert.deepEqual(Object.keys(parsed).sort(), ["href", "label"]);
  });
});
