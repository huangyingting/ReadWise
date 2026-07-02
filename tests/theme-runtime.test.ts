process.env.LOG_LEVEL = "error";

import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import {
  applyTheme,
  getActiveTheme,
  getStoredTheme,
  getSystemTheme,
  getThemePreference,
  resolveTheme,
  setTheme,
  THEME_STORAGE_KEY,
  toggleTheme,
} from "@/lib/theme";

type MutableGlobal = typeof globalThis & {
  document?: Document;
  window?: Window;
  Node?: typeof Node;
  NodeFilter?: typeof NodeFilter;
};

const originalGlobals = {
  document: (globalThis as MutableGlobal).document,
  window: (globalThis as MutableGlobal).window,
  Node: (globalThis as MutableGlobal).Node,
  NodeFilter: (globalThis as MutableGlobal).NodeFilter,
};

function restoreGlobal<K extends keyof typeof originalGlobals>(key: K): void {
  const g = globalThis as MutableGlobal;
  const value = originalGlobals[key];
  if (value === undefined) {
    delete g[key];
  } else {
    g[key] = value as never;
  }
}

function restoreGlobals(): void {
  restoreGlobal("document");
  restoreGlobal("window");
  restoreGlobal("Node");
  restoreGlobal("NodeFilter");
}

function installDom(html: string): Document {
  const { document, window } = parseHTML(html);
  Object.assign(globalThis, {
    document,
    window,
    Node: window.Node,
    NodeFilter: window.NodeFilter ?? { SHOW_TEXT: 4 },
  });
  return document;
}

function installThemeEnv(options: {
  stored?: string | null;
  prefersDark?: boolean;
  getThrows?: boolean;
  setThrows?: boolean;
} = {}) {
  const document = installDom("<html><body></body></html>");
  let stored = options.stored ?? null;
  const storage = {
    getItem(key: string) {
      assert.equal(key, THEME_STORAGE_KEY);
      if (options.getThrows) throw new Error("storage unavailable");
      return stored;
    },
    setItem(key: string, value: string) {
      assert.equal(key, THEME_STORAGE_KEY);
      if (options.setThrows) throw new Error("quota exceeded");
      stored = value;
    },
  };

  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
  });
  Object.defineProperty(window, "matchMedia", {
    value: () => ({ matches: Boolean(options.prefersDark) }),
    configurable: true,
  });

  return {
    document,
    get stored() {
      return stored;
    },
  };
}

afterEach(() => {
  restoreGlobals();
});

describe("theme runtime helpers", () => {
  test("are safe when DOM globals are absent", () => {
    restoreGlobals();

    assert.equal(getStoredTheme(), null);
    assert.equal(getThemePreference(), "system");
    assert.equal(getSystemTheme(), "light");
    assert.equal(getActiveTheme(), "light");
    assert.doesNotThrow(() => applyTheme("dark"));
    assert.doesNotThrow(() => setTheme("system"));
    assert.equal(toggleTheme(), "light");
  });

  test("reads valid stored values and ignores invalid or throwing storage", () => {
    installThemeEnv({ stored: "dark" });
    assert.equal(getStoredTheme(), "dark");
    assert.equal(getThemePreference(), "dark");

    installThemeEnv({ stored: "sepia" });
    assert.equal(getStoredTheme(), null);

    installThemeEnv({ stored: "light", getThrows: true });
    assert.equal(getStoredTheme(), null);
  });

  test("resolves system preference and lets data-theme override active theme", () => {
    const env = installThemeEnv({ stored: "system", prefersDark: true });

    assert.equal(getSystemTheme(), "dark");
    assert.equal(resolveTheme("system"), "dark");
    assert.equal(resolveTheme("light"), "light");
    assert.equal(getActiveTheme(), "dark");

    env.document.documentElement.dataset.theme = "light";
    assert.equal(getActiveTheme(), "light");
  });

  test("applies, persists, and cycles the three theme states", () => {
    const env = installThemeEnv({ stored: null, prefersDark: false });

    applyTheme("dark");
    assert.equal(env.document.documentElement.dataset.theme, "dark");

    applyTheme("system");
    assert.equal(env.document.documentElement.dataset.theme, undefined);

    setTheme("light");
    assert.equal(env.stored, "light");
    assert.equal(env.document.documentElement.dataset.theme, "light");

    assert.equal(toggleTheme(), "dark");
    assert.equal(env.stored, "dark");
    assert.equal(env.document.documentElement.dataset.theme, "dark");

    assert.equal(toggleTheme(), "system");
    assert.equal(env.stored, "system");
    assert.equal(env.document.documentElement.dataset.theme, undefined);
  });

  test("still applies the runtime theme when localStorage setItem throws", () => {
    const env = installThemeEnv({ stored: "system", setThrows: true });

    setTheme("dark");

    assert.equal(env.document.documentElement.dataset.theme, "dark");
  });
});
