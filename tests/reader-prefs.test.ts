/**
 * Tests for src/lib/reader-prefs.ts (REF-055).
 *
 * Covers:
 *   - localStorage parsing (valid prefs, absent key, invalid JSON, partial)
 *   - Invalid preference values (bad mode, bad fontScale, bad fontFamily/spacing)
 *   - Default resolution (no stored prefs → app-theme-based default)
 *   - DOM application (applyReaderPrefs sets data-* attributes and CSS var)
 *   - Font-scale stepping (up/down, clamped at limits)
 *   - Bootstrap script output (buildBootstrapScript)
 *
 * All DOM / localStorage dependencies are handled with lightweight stubs so
 * tests run in Node.js without a browser.
 */

import { test, describe, beforeEach, before, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Minimal localStorage stub
// ---------------------------------------------------------------------------

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string): string | null => store.get(k) ?? null,
    setItem: (k: string, v: string): void => { store.set(k, v); },
    removeItem: (k: string): void => { store.delete(k); },
    clear: (): void => { store.clear(); },
    store,
  };
}

// ---------------------------------------------------------------------------
// Mock @/lib/theme before any import of @/lib/reader-prefs (which imports it)
// ---------------------------------------------------------------------------

let mockActiveTheme: "light" | "dark" = "light";

before(() => {
  mock.module("@/lib/theme", {
    namedExports: {
      getActiveTheme: () => mockActiveTheme,
    },
  });
});

// ---------------------------------------------------------------------------
// Setup: install window + document stubs before each test
// ---------------------------------------------------------------------------

let ls = makeLocalStorage();

beforeEach(() => {
  ls = makeLocalStorage();
  (global as Record<string, unknown>).window = { localStorage: ls };
  (global as Record<string, unknown>).document = {
    getElementById: (_id: string): HTMLElement | null => null,
    documentElement: { dataset: { theme: "" } },
  };
  mockActiveTheme = "light";
});

// ---------------------------------------------------------------------------
// stepFontScale — pure logic, no DOM
// ---------------------------------------------------------------------------

describe("stepFontScale", () => {
  test("steps up from default (1.0 → 1.15)", async () => {
    const { stepFontScale } = await import("@/lib/reader-prefs");
    assert.equal(stepFontScale(1.0, "up"), 1.15);
  });

  test("steps down from default (1.0 → 0.9)", async () => {
    const { stepFontScale } = await import("@/lib/reader-prefs");
    assert.equal(stepFontScale(1.0, "down"), 0.9);
  });

  test("clamps at maximum (1.45 up → 1.45)", async () => {
    const { stepFontScale } = await import("@/lib/reader-prefs");
    assert.equal(stepFontScale(1.45, "up"), 1.45);
  });

  test("clamps at minimum (0.9 down → 0.9)", async () => {
    const { stepFontScale } = await import("@/lib/reader-prefs");
    assert.equal(stepFontScale(0.9, "down"), 0.9);
  });

  test("steps through all up: 0.9 → 1.0 → 1.15 → 1.3 → 1.45", async () => {
    const { stepFontScale } = await import("@/lib/reader-prefs");
    const steps = [0.9, 1.0, 1.15, 1.3, 1.45];
    for (let i = 0; i < steps.length - 1; i++) {
      assert.equal(stepFontScale(steps[i], "up"), steps[i + 1]);
    }
  });

  test("steps through all down: 1.45 → 1.3 → 1.15 → 1.0 → 0.9", async () => {
    const { stepFontScale } = await import("@/lib/reader-prefs");
    const steps = [1.45, 1.3, 1.15, 1.0, 0.9];
    for (let i = 0; i < steps.length - 1; i++) {
      assert.equal(stepFontScale(steps[i], "down"), steps[i + 1]);
    }
  });

  test("unknown scale (e.g. 0.5) defaults to index 1 → down gives 0.9", async () => {
    const { stepFontScale } = await import("@/lib/reader-prefs");
    // indexOf returns -1, currentIdx falls back to 1 (1.0); down → 0.9
    assert.equal(stepFontScale(0.5, "down"), 0.9);
  });

  test("unknown scale → up gives 1.15", async () => {
    const { stepFontScale } = await import("@/lib/reader-prefs");
    assert.equal(stepFontScale(0.5, "up"), 1.15);
  });
});

// ---------------------------------------------------------------------------
// fontScaleLabel — pure logic, no DOM
// ---------------------------------------------------------------------------

describe("fontScaleLabel", () => {
  test("returns correct labels for all five steps", async () => {
    const { fontScaleLabel } = await import("@/lib/reader-prefs");
    assert.equal(fontScaleLabel(0.9), "Small");
    assert.equal(fontScaleLabel(1.0), "Default");
    assert.equal(fontScaleLabel(1.15), "Large");
    assert.equal(fontScaleLabel(1.3), "Extra large");
    assert.equal(fontScaleLabel(1.45), "Huge");
  });

  test("returns 'Default' for unknown scale", async () => {
    const { fontScaleLabel } = await import("@/lib/reader-prefs");
    assert.equal(fontScaleLabel(999), "Default");
  });
});

// ---------------------------------------------------------------------------
// getStoredReaderPrefs — localStorage parsing
// ---------------------------------------------------------------------------

describe("getStoredReaderPrefs", () => {
  test("returns null when window is undefined (SSR)", async () => {
    delete (global as Record<string, unknown>).window;
    const { getStoredReaderPrefs } = await import("@/lib/reader-prefs");
    assert.equal(getStoredReaderPrefs(), null);
  });

  test("returns null when key is absent", async () => {
    const { getStoredReaderPrefs } = await import("@/lib/reader-prefs");
    assert.equal(getStoredReaderPrefs(), null);
  });

  test("returns null for invalid JSON", async () => {
    ls.setItem("readwise:reader-prefs", "not-json{{{");
    const { getStoredReaderPrefs } = await import("@/lib/reader-prefs");
    assert.equal(getStoredReaderPrefs(), null);
  });

  test("returns null when mode is invalid", async () => {
    ls.setItem("readwise:reader-prefs", JSON.stringify({ mode: "purple", fontScale: 1.0 }));
    const { getStoredReaderPrefs } = await import("@/lib/reader-prefs");
    assert.equal(getStoredReaderPrefs(), null);
  });

  test("returns null when fontScale is not a valid step", async () => {
    ls.setItem("readwise:reader-prefs", JSON.stringify({ mode: "light", fontScale: 2.5 }));
    const { getStoredReaderPrefs } = await import("@/lib/reader-prefs");
    assert.equal(getStoredReaderPrefs(), null);
  });

  test("returns null when mode is missing", async () => {
    ls.setItem("readwise:reader-prefs", JSON.stringify({ fontScale: 1.0 }));
    const { getStoredReaderPrefs } = await import("@/lib/reader-prefs");
    assert.equal(getStoredReaderPrefs(), null);
  });

  test("returns null when fontScale is missing", async () => {
    ls.setItem("readwise:reader-prefs", JSON.stringify({ mode: "dark" }));
    const { getStoredReaderPrefs } = await import("@/lib/reader-prefs");
    assert.equal(getStoredReaderPrefs(), null);
  });

  test("returns valid prefs with all fields set", async () => {
    ls.setItem(
      "readwise:reader-prefs",
      JSON.stringify({ mode: "sepia", fontScale: 1.15, fontFamily: "sans", lineSpacing: "comfortable" }),
    );
    const { getStoredReaderPrefs } = await import("@/lib/reader-prefs");
    const prefs = getStoredReaderPrefs();
    assert.ok(prefs);
    assert.equal(prefs.mode, "sepia");
    assert.equal(prefs.fontScale, 1.15);
    assert.equal(prefs.fontFamily, "sans");
    assert.equal(prefs.lineSpacing, "comfortable");
  });

  test("returns prefs with fontFamily default 'serif' when absent", async () => {
    ls.setItem("readwise:reader-prefs", JSON.stringify({ mode: "dark", fontScale: 1.3 }));
    const { getStoredReaderPrefs } = await import("@/lib/reader-prefs");
    const prefs = getStoredReaderPrefs();
    assert.ok(prefs);
    assert.equal(prefs.fontFamily, "serif");
  });

  test("returns prefs with fontFamily default 'serif' when value is invalid", async () => {
    ls.setItem(
      "readwise:reader-prefs",
      JSON.stringify({ mode: "light", fontScale: 1.0, fontFamily: "comic-sans" }),
    );
    const { getStoredReaderPrefs } = await import("@/lib/reader-prefs");
    const prefs = getStoredReaderPrefs();
    assert.ok(prefs);
    assert.equal(prefs.fontFamily, "serif");
  });

  test("returns prefs with lineSpacing default 'normal' when absent", async () => {
    ls.setItem("readwise:reader-prefs", JSON.stringify({ mode: "light", fontScale: 1.0 }));
    const { getStoredReaderPrefs } = await import("@/lib/reader-prefs");
    const prefs = getStoredReaderPrefs();
    assert.ok(prefs);
    assert.equal(prefs.lineSpacing, "normal");
  });

  test("returns prefs with lineSpacing default 'normal' when value is invalid", async () => {
    ls.setItem(
      "readwise:reader-prefs",
      JSON.stringify({ mode: "light", fontScale: 1.0, lineSpacing: "wide" }),
    );
    const { getStoredReaderPrefs } = await import("@/lib/reader-prefs");
    const prefs = getStoredReaderPrefs();
    assert.ok(prefs);
    assert.equal(prefs.lineSpacing, "normal");
  });

  test("accepts 'dyslexic' as a valid fontFamily", async () => {
    ls.setItem(
      "readwise:reader-prefs",
      JSON.stringify({ mode: "light", fontScale: 1.0, fontFamily: "dyslexic" }),
    );
    const { getStoredReaderPrefs } = await import("@/lib/reader-prefs");
    const prefs = getStoredReaderPrefs();
    assert.ok(prefs);
    assert.equal(prefs.fontFamily, "dyslexic");
  });

  test("accepts 'spacious' as a valid lineSpacing", async () => {
    ls.setItem(
      "readwise:reader-prefs",
      JSON.stringify({ mode: "dark", fontScale: 1.45, lineSpacing: "spacious" }),
    );
    const { getStoredReaderPrefs } = await import("@/lib/reader-prefs");
    const prefs = getStoredReaderPrefs();
    assert.ok(prefs);
    assert.equal(prefs.lineSpacing, "spacious");
  });
});

// ---------------------------------------------------------------------------
// getReaderPrefs — default resolution
// ---------------------------------------------------------------------------

describe("getReaderPrefs", () => {
  test("returns stored prefs when available", async () => {
    ls.setItem(
      "readwise:reader-prefs",
      JSON.stringify({ mode: "sepia", fontScale: 1.3, fontFamily: "sans", lineSpacing: "spacious" }),
    );
    const { getReaderPrefs } = await import("@/lib/reader-prefs");
    const prefs = getReaderPrefs();
    assert.equal(prefs.mode, "sepia");
    assert.equal(prefs.fontScale, 1.3);
  });

  test("returns light-mode defaults when no stored prefs and app theme is light", async () => {
    mockActiveTheme = "light";
    const { getReaderPrefs } = await import("@/lib/reader-prefs");
    const prefs = getReaderPrefs();
    assert.equal(prefs.mode, "light");
    assert.equal(prefs.fontScale, 1.0);
    assert.equal(prefs.fontFamily, "serif");
    assert.equal(prefs.lineSpacing, "normal");
  });

  test("returns dark-mode defaults when no stored prefs and app theme is dark", async () => {
    mockActiveTheme = "dark";
    const { getReaderPrefs } = await import("@/lib/reader-prefs");
    const prefs = getReaderPrefs();
    assert.equal(prefs.mode, "dark");
  });
});

// ---------------------------------------------------------------------------
// applyReaderPrefs — DOM application
// ---------------------------------------------------------------------------

describe("applyReaderPrefs", () => {
  function makeElement() {
    const _style = new Map<string, string>();
    return {
      dataset: {} as Record<string, string>,
      style: {
        setProperty: (k: string, v: string) => { _style.set(k, v); },
        getProperty: (k: string) => _style.get(k) ?? null,
        _map: _style,
      },
    } as unknown as HTMLElement & { style: { _map: Map<string, string> } };
  }

  test("sets data-reading-mode on the provided element", async () => {
    const { applyReaderPrefs } = await import("@/lib/reader-prefs");
    const el = makeElement();
    applyReaderPrefs({ mode: "sepia", fontScale: 1.15, fontFamily: "sans", lineSpacing: "comfortable" }, el);
    assert.equal((el as unknown as { dataset: Record<string, string> }).dataset.readingMode, "sepia");
  });

  test("sets data-reading-font on the provided element", async () => {
    const { applyReaderPrefs } = await import("@/lib/reader-prefs");
    const el = makeElement();
    applyReaderPrefs({ mode: "light", fontScale: 1.0, fontFamily: "dyslexic", lineSpacing: "normal" }, el);
    assert.equal((el as unknown as { dataset: Record<string, string> }).dataset.readingFont, "dyslexic");
  });

  test("sets data-reading-spacing on the provided element", async () => {
    const { applyReaderPrefs } = await import("@/lib/reader-prefs");
    const el = makeElement();
    applyReaderPrefs({ mode: "dark", fontScale: 1.3, fontFamily: "serif", lineSpacing: "spacious" }, el);
    assert.equal((el as unknown as { dataset: Record<string, string> }).dataset.readingSpacing, "spacious");
  });

  test("sets --reading-font-scale CSS custom property", async () => {
    const { applyReaderPrefs } = await import("@/lib/reader-prefs");
    const el = makeElement();
    applyReaderPrefs({ mode: "light", fontScale: 1.45, fontFamily: "serif", lineSpacing: "normal" }, el);
    assert.equal((el as unknown as { style: { _map: Map<string, string> } }).style._map.get("--reading-font-scale"), "1.45");
  });

  test("no-ops when document is not available (SSR)", async () => {
    delete (global as Record<string, unknown>).document;
    const { applyReaderPrefs } = await import("@/lib/reader-prefs");
    // Should not throw
    assert.doesNotThrow(() =>
      applyReaderPrefs({ mode: "dark", fontScale: 1.0, fontFamily: "serif", lineSpacing: "normal" }),
    );
  });
});

// ---------------------------------------------------------------------------
// setReaderPrefs — persist + apply
// ---------------------------------------------------------------------------

describe("setReaderPrefs", () => {
  function makeElement() {
    return {
      dataset: {} as Record<string, string>,
      style: { setProperty: (_k: string, _v: string) => {} },
    } as unknown as HTMLElement;
  }

  test("persists prefs to localStorage as JSON", async () => {
    const { setReaderPrefs } = await import("@/lib/reader-prefs");
    const el = makeElement();
    const prefs = { mode: "dark" as const, fontScale: 1.3, fontFamily: "sans" as const, lineSpacing: "comfortable" as const };
    setReaderPrefs(prefs, el);
    const stored = ls.getItem("readwise:reader-prefs");
    assert.ok(stored);
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    assert.equal(parsed.mode, "dark");
    assert.equal(parsed.fontScale, 1.3);
  });

  test("applies prefs to the provided element", async () => {
    const { setReaderPrefs } = await import("@/lib/reader-prefs");
    const el = makeElement();
    setReaderPrefs({ mode: "sepia", fontScale: 1.15, fontFamily: "serif", lineSpacing: "normal" }, el);
    assert.equal((el as unknown as { dataset: Record<string, string> }).dataset.readingMode, "sepia");
  });
});

// ---------------------------------------------------------------------------
// buildBootstrapScript — script text structure
// ---------------------------------------------------------------------------

describe("buildBootstrapScript", () => {
  test("returns a non-empty string", async () => {
    const { buildBootstrapScript } = await import("@/lib/reader-prefs");
    const script = buildBootstrapScript();
    assert.ok(typeof script === "string" && script.length > 0);
  });

  test("contains the READER_PREFS_KEY literal", async () => {
    const { buildBootstrapScript, READER_PREFS_KEY } = await import("@/lib/reader-prefs");
    const script = buildBootstrapScript();
    assert.ok(script.includes(READER_PREFS_KEY), `Script must contain key '${READER_PREFS_KEY}'`);
  });

  test("wraps code in an IIFE with try/catch", async () => {
    const { buildBootstrapScript } = await import("@/lib/reader-prefs");
    const script = buildBootstrapScript();
    assert.ok(script.includes("(function()"), "Script must be an IIFE");
    assert.ok(script.includes("try{") || script.includes("try {"), "Script must have try/catch");
    assert.ok(script.includes("}catch(e)"), "Script must catch errors silently");
  });

  test("applies data-reading-mode attribute", async () => {
    const { buildBootstrapScript } = await import("@/lib/reader-prefs");
    const script = buildBootstrapScript();
    assert.ok(script.includes("dataset.readingMode"), "Script must set data-reading-mode");
  });

  test("applies --reading-font-scale CSS custom property", async () => {
    const { buildBootstrapScript } = await import("@/lib/reader-prefs");
    const script = buildBootstrapScript();
    assert.ok(script.includes("--reading-font-scale"), "Script must set --reading-font-scale");
  });

  test("applies data-reading-font attribute", async () => {
    const { buildBootstrapScript } = await import("@/lib/reader-prefs");
    const script = buildBootstrapScript();
    assert.ok(script.includes("dataset.readingFont"), "Script must set data-reading-font");
  });

  test("applies data-reading-spacing attribute", async () => {
    const { buildBootstrapScript } = await import("@/lib/reader-prefs");
    const script = buildBootstrapScript();
    assert.ok(script.includes("dataset.readingSpacing"), "Script must set data-reading-spacing");
  });

  test("falls back to dark mode when html data-theme is dark", async () => {
    const { buildBootstrapScript } = await import("@/lib/reader-prefs");
    const script = buildBootstrapScript();
    assert.ok(script.includes("'dark'"), "Script must include dark-mode fallback");
  });

  test("defaults font family to 'serif' when pref is absent", async () => {
    const { buildBootstrapScript } = await import("@/lib/reader-prefs");
    const script = buildBootstrapScript();
    assert.ok(script.includes("'serif'"), "Script must include serif font default");
  });

  test("defaults line spacing to 'normal' when pref is absent", async () => {
    const { buildBootstrapScript } = await import("@/lib/reader-prefs");
    const script = buildBootstrapScript();
    assert.ok(script.includes("'normal'"), "Script must include normal spacing default");
  });

  test("uses currentScript.parentElement to target the reader root", async () => {
    const { buildBootstrapScript } = await import("@/lib/reader-prefs");
    const script = buildBootstrapScript();
    assert.ok(
      script.includes("currentScript") && script.includes("parentElement"),
      "Script must target currentScript.parentElement for pre-paint application",
    );
  });
});
