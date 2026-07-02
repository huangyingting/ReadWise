process.env.LOG_LEVEL = "error";

import { afterEach, beforeEach, mock } from "node:test";
import { parseHTML } from "linkedom";

type Cleanup = () => void;
type MutableGlobal = typeof globalThis & {
  CSS?: unknown;
  document?: Document;
  Highlight?: unknown;
  IntersectionObserver?: unknown;
  Node?: typeof Node;
  NodeFilter?: typeof NodeFilter;
  Range?: unknown;
  window?: Window;
};

let states: unknown[] = [];
let refs: Array<{ current: unknown }> = [];
let stateCursor = 0;
let refCursor = 0;
let cleanups: Cleanup[] = [];

export function beginRender(): void {
  stateCursor = 0;
  refCursor = 0;
}

export function resetHookStorage(): void {
  states = [];
  refs = [];
  cleanups = [];
  beginRender();
}

export function runCleanups(): void {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup();
  }
}

export function getHookState<T = unknown>(index: number): T | undefined {
  return states[index] as T | undefined;
}

export function getHookRef<T = unknown>(
  index: number,
): { current: T } | undefined {
  return refs[index] as { current: T } | undefined;
}

export function popHookCleanup(): Cleanup | undefined {
  return cleanups.pop();
}

function useStateMock<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
  const index = stateCursor++;
  if (!(index in states)) {
    states[index] =
      typeof initial === "function" ? (initial as () => T)() : initial;
  }
  return [
    states[index] as T,
    (next) => {
      states[index] =
        typeof next === "function"
          ? (next as (prev: T) => T)(states[index] as T)
          : next;
    },
  ];
}

function useRefMock<T>(initial: T): { current: T } {
  const index = refCursor++;
  if (!refs[index]) refs[index] = { current: initial };
  return refs[index] as { current: T };
}

mock.module("react", {
  namedExports: {
    useCallback: (fn: unknown) => fn,
    useEffect: (effect: () => unknown) => {
      const cleanup = effect();
      if (typeof cleanup === "function") cleanups.push(cleanup as Cleanup);
    },
    useRef: useRefMock,
    useState: useStateMock,
  },
});

const originalGlobals = {
  CSS: (globalThis as MutableGlobal).CSS,
  document: (globalThis as MutableGlobal).document,
  Highlight: (globalThis as MutableGlobal).Highlight,
  IntersectionObserver: (globalThis as MutableGlobal).IntersectionObserver,
  Node: (globalThis as MutableGlobal).Node,
  NodeFilter: (globalThis as MutableGlobal).NodeFilter,
  Range: (globalThis as MutableGlobal).Range,
  window: (globalThis as MutableGlobal).window,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
};

function restoreGlobal<K extends keyof Omit<typeof originalGlobals, "setTimeout" | "clearTimeout">>(
  key: K,
): void {
  const g = globalThis as MutableGlobal;
  const value = originalGlobals[key];
  if (value === undefined) {
    delete g[key];
  } else {
    g[key] = value as never;
  }
}

export function restoreGlobals(): void {
  restoreGlobal("CSS");
  restoreGlobal("document");
  restoreGlobal("Highlight");
  restoreGlobal("IntersectionObserver");
  restoreGlobal("Node");
  restoreGlobal("NodeFilter");
  restoreGlobal("Range");
  restoreGlobal("window");
  globalThis.setTimeout = originalGlobals.setTimeout;
  globalThis.clearTimeout = originalGlobals.clearTimeout;
}

export function installDom(html: string): Document {
  const { document, window } = parseHTML(html);
  Object.assign(globalThis, {
    document,
    window,
    Node: window.Node,
    NodeFilter: window.NodeFilter ?? { SHOW_TEXT: 4 },
  });
  return document;
}

export function article(id: string): { id: string } {
  return { id };
}

export async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  resetHookStorage();
  restoreGlobals();
});

afterEach(() => {
  runCleanups();
  restoreGlobals();
});
