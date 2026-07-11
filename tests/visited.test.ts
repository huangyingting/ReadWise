/**
 * Tests for src/lib/visited.ts — sessionStorage-backed article visit tracking.
 * Covers SSR fallback, dedup, clear, malformed data, and storage errors.
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
let visited: typeof import("@/lib/visited");

beforeEach(async () => {
  storage = createStorageStub();
  (globalThis as Record<string, unknown>).sessionStorage = storage;
  if (typeof globalThis.window === "undefined") {
    (globalThis as Record<string, unknown>).window = globalThis;
  }
  visited = await import("@/lib/visited");
});

describe("visited article tracking", () => {
  test("getVisitedArticleIds returns empty array initially", () => {
    assert.deepEqual(visited.getVisitedArticleIds(), []);
  });

  test("markArticleVisited adds an article id", () => {
    visited.markArticleVisited("art-1");
    assert.deepEqual(visited.getVisitedArticleIds(), ["art-1"]);
  });

  test("markArticleVisited deduplicates repeated visits", () => {
    visited.markArticleVisited("art-1");
    visited.markArticleVisited("art-1");
    assert.deepEqual(visited.getVisitedArticleIds(), ["art-1"]);
  });

  test("markArticleVisited ignores empty id", () => {
    visited.markArticleVisited("");
    assert.deepEqual(visited.getVisitedArticleIds(), []);
  });

  test("clearVisitedArticleIds removes only specified ids", () => {
    visited.markArticleVisited("a");
    visited.markArticleVisited("b");
    visited.markArticleVisited("c");
    visited.clearVisitedArticleIds(["a", "c"]);
    assert.deepEqual(visited.getVisitedArticleIds(), ["b"]);
  });

  test("clearVisitedArticleIds with empty array is a no-op", () => {
    visited.markArticleVisited("x");
    visited.clearVisitedArticleIds([]);
    assert.deepEqual(visited.getVisitedArticleIds(), ["x"]);
  });

  test("gracefully handles malformed JSON in storage", () => {
    storage.setItem("readwise:visited-articles", "not-json");
    // Should not throw; returns empty
    assert.deepEqual(visited.getVisitedArticleIds(), []);
  });

  test("gracefully handles non-array JSON in storage", () => {
    storage.setItem("readwise:visited-articles", JSON.stringify({ bad: true }));
    assert.deepEqual(visited.getVisitedArticleIds(), []);
  });

  test("filters non-string entries from stored array", () => {
    storage.setItem("readwise:visited-articles", JSON.stringify(["ok", 123, null, "also-ok"]));
    assert.deepEqual(visited.getVisitedArticleIds(), ["ok", "also-ok"]);
  });

  test("markArticleVisited silently handles storage write errors", () => {
    (globalThis as Record<string, unknown>).sessionStorage = {
      ...storage,
      setItem() { throw new Error("QuotaExceeded"); },
      getItem: storage.getItem.bind(storage),
    };
    // Should not throw
    visited.markArticleVisited("art-2");
  });

  test("returns empty and no-ops in SSR (no window)", () => {
    const origWindow = (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).window;
    try {
      assert.deepEqual(visited.getVisitedArticleIds(), []);
      visited.markArticleVisited("ssr-id");
      visited.clearVisitedArticleIds(["x"]);
    } finally {
      (globalThis as Record<string, unknown>).window = origWindow;
    }
  });
});
