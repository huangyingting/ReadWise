/**
 * Tests for src/lib/bookmarkChanges.ts — sessionStorage-backed bookmark
 * change tracking. Covers SSR fallback, dedup, clear, malformed data,
 * and storage errors.
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
let bookmarkChanges: typeof import("@/lib/bookmarkChanges");

beforeEach(async () => {
  storage = createStorageStub();
  (globalThis as Record<string, unknown>).sessionStorage = storage;
  if (typeof globalThis.window === "undefined") {
    (globalThis as Record<string, unknown>).window = globalThis;
  }
  bookmarkChanges = await import("@/lib/bookmarkChanges");
});

describe("bookmark change tracking", () => {
  test("getBookmarkChangedIds returns empty array initially", () => {
    assert.deepEqual(bookmarkChanges.getBookmarkChangedIds(), []);
  });

  test("markBookmarkChanged adds an article id", () => {
    bookmarkChanges.markBookmarkChanged("art-1");
    assert.deepEqual(bookmarkChanges.getBookmarkChangedIds(), ["art-1"]);
  });

  test("markBookmarkChanged deduplicates repeated marks", () => {
    bookmarkChanges.markBookmarkChanged("art-1");
    bookmarkChanges.markBookmarkChanged("art-1");
    assert.deepEqual(bookmarkChanges.getBookmarkChangedIds(), ["art-1"]);
  });

  test("markBookmarkChanged ignores empty id", () => {
    bookmarkChanges.markBookmarkChanged("");
    assert.deepEqual(bookmarkChanges.getBookmarkChangedIds(), []);
  });

  test("clearBookmarkChangedIds removes only specified ids", () => {
    bookmarkChanges.markBookmarkChanged("a");
    bookmarkChanges.markBookmarkChanged("b");
    bookmarkChanges.markBookmarkChanged("c");
    bookmarkChanges.clearBookmarkChangedIds(["a", "c"]);
    assert.deepEqual(bookmarkChanges.getBookmarkChangedIds(), ["b"]);
  });

  test("clearBookmarkChangedIds with empty array is a no-op", () => {
    bookmarkChanges.markBookmarkChanged("x");
    bookmarkChanges.clearBookmarkChangedIds([]);
    assert.deepEqual(bookmarkChanges.getBookmarkChangedIds(), ["x"]);
  });

  test("gracefully handles malformed JSON in storage", () => {
    storage.setItem("readwise:bookmark-changes", "not-json");
    assert.deepEqual(bookmarkChanges.getBookmarkChangedIds(), []);
  });

  test("gracefully handles non-array JSON in storage", () => {
    storage.setItem("readwise:bookmark-changes", JSON.stringify({ bad: true }));
    assert.deepEqual(bookmarkChanges.getBookmarkChangedIds(), []);
  });

  test("filters non-string entries from stored array", () => {
    storage.setItem("readwise:bookmark-changes", JSON.stringify(["ok", 42, null, "fine"]));
    assert.deepEqual(bookmarkChanges.getBookmarkChangedIds(), ["ok", "fine"]);
  });

  test("markBookmarkChanged silently handles storage write errors", () => {
    (globalThis as Record<string, unknown>).sessionStorage = {
      ...storage,
      setItem() { throw new Error("QuotaExceeded"); },
      getItem: storage.getItem.bind(storage),
    };
    // Should not throw
    bookmarkChanges.markBookmarkChanged("art-2");
  });

  test("returns empty and no-ops in SSR (no window)", () => {
    const origWindow = (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).window;
    try {
      assert.deepEqual(bookmarkChanges.getBookmarkChangedIds(), []);
      bookmarkChanges.markBookmarkChanged("ssr-id");
      bookmarkChanges.clearBookmarkChangedIds(["x"]);
    } finally {
      (globalThis as Record<string, unknown>).window = origWindow;
    }
  });
});
