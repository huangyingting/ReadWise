/**
 * Tests for src/lib/translate-lang.ts — localStorage-backed translation
 * language persistence. Covers SSR fallback, default value, and round-trip.
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
  (globalThis as Record<string, unknown>).localStorage = storage;
  if (typeof globalThis.window === "undefined") {
    (globalThis as Record<string, unknown>).window = globalThis;
  }
});

describe("translate-lang", () => {
  test("getTranslateLang returns default when nothing is stored", async () => {
    const { getTranslateLang, TRANSLATE_LANG_DEFAULT } = await import(
      "@/lib/translate-lang"
    );
    assert.equal(getTranslateLang(), TRANSLATE_LANG_DEFAULT);
  });

  test("setTranslateLang persists and getTranslateLang reads it back", async () => {
    const { setTranslateLang, getTranslateLang, TRANSLATE_LANG_KEY } =
      await import("@/lib/translate-lang");

    setTranslateLang("ja");
    assert.equal(storage.getItem(TRANSLATE_LANG_KEY), "ja");
    assert.equal(getTranslateLang(), "ja");
  });

  test("default is zh-Hans", async () => {
    const { TRANSLATE_LANG_DEFAULT } = await import("@/lib/translate-lang");
    assert.equal(TRANSLATE_LANG_DEFAULT, "zh-Hans");
  });

  test("TRANSLATE_LANG_KEY matches the storage-keys registry", async () => {
    const { TRANSLATE_LANG_KEY } = await import("@/lib/translate-lang");
    const { STORAGE_KEYS } = await import("@/lib/storage-keys");
    assert.equal(TRANSLATE_LANG_KEY, STORAGE_KEYS.TRANSLATE_LANG);
  });

  test("getTranslateLang returns default in SSR (no window)", async () => {
    const { getTranslateLang, TRANSLATE_LANG_DEFAULT } = await import(
      "@/lib/translate-lang"
    );
    const origWindow = (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).window;
    try {
      assert.equal(getTranslateLang(), TRANSLATE_LANG_DEFAULT);
    } finally {
      (globalThis as Record<string, unknown>).window = origWindow;
    }
  });

  test("setTranslateLang is a no-op in SSR (no window)", async () => {
    const { setTranslateLang } = await import("@/lib/translate-lang");
    const origWindow = (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).window;
    try {
      setTranslateLang("fr"); // Should not throw
    } finally {
      (globalThis as Record<string, unknown>).window = origWindow;
    }
  });
});
