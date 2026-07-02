process.env.LOG_LEVEL = "error";

import { afterEach, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
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

function beginRender(): void {
  stateCursor = 0;
  refCursor = 0;
}

function resetHookStorage(): void {
  states = [];
  refs = [];
  cleanups = [];
  beginRender();
}

function runCleanups(): void {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup();
  }
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

function restoreGlobals(): void {
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

function article(id: string): { id: string } {
  return { id };
}

async function flushAsyncWork(): Promise<void> {
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

describe("useLoadMoreList hook behavior", () => {
  test("loads a page, deduplicates articles, merges progress, and notifies caller", async () => {
    const { useLoadMoreList } = await import("@/hooks/useLoadMoreList");
    const loaded: Array<{ page: unknown; ids: string[] }> = [];

    const fetchPage = async (offset: number) => {
      assert.equal(offset, 2);
      return {
        articles: [article("b"), article("c")],
        progress: { c: { readPercent: 50 } },
        offset: 4,
        hasMore: false,
      };
    };

    function useRenderLoadMoreList() {
      beginRender();
      return useLoadMoreList({
        initialArticles: [article("a"), article("b")] as never,
        initialProgress: { a: { readPercent: 10 } } as never,
        initialHasMore: true,
        initialOffset: 2,
        fetchPage: fetchPage as never,
        onPageLoaded: (page, newArticles) => {
          loaded.push({
            page,
            ids: newArticles.map((item) => item.id),
          });
        },
      });
    }

    useRenderLoadMoreList().loadMore();
    await flushAsyncWork();
    const after = useRenderLoadMoreList();

    assert.deepEqual(
      after.articles.map((item) => item.id),
      ["a", "b", "c"],
    );
    assert.deepEqual(Object.keys(after.progress).sort(), ["a", "c"]);
    assert.equal(after.hasMore, false);
    assert.equal(after.loading, false);
    assert.equal(after.loadError, null);
    assert.deepEqual(loaded[0]?.ids, ["b", "c"]);
  });

  test("does not fetch while loading or when no more pages are available", async () => {
    const { useLoadMoreList } = await import("@/hooks/useLoadMoreList");
    let calls = 0;
    let resolvePage: (page: { articles?: never[]; hasMore?: boolean }) => void =
      () => {};

    beginRender();
    const noMore = useLoadMoreList({
      initialArticles: [],
      initialProgress: {},
      initialHasMore: false,
      initialOffset: 0,
      fetchPage: (async () => {
        calls++;
        return {};
      }) as never,
    });
    noMore.loadMore();
    assert.equal(calls, 0);

    resetHookStorage();
    beginRender();
    const loading = useLoadMoreList({
      initialArticles: [article("a")] as never,
      initialProgress: {},
      initialHasMore: true,
      initialOffset: 1,
      fetchPage: (() => {
        calls++;
        return new Promise((resolve) => {
          resolvePage = resolve;
        });
      }) as never,
    });

    loading.loadMore();
    loading.loadMore();
    assert.equal(calls, 1);

    resolvePage({});
    await flushAsyncWork();
    beginRender();
    const after = useLoadMoreList({
      initialArticles: [] as never,
      initialProgress: {},
      initialHasMore: true,
      initialOffset: 1,
      fetchPage: (async () => ({})) as never,
    });
    assert.equal(after.hasMore, false);
    assert.equal(after.loading, false);
  });

  test("surfaces the configured error message after a failed page load", async () => {
    const { useLoadMoreList } = await import("@/hooks/useLoadMoreList");

    function useRenderLoadMoreList() {
      beginRender();
      return useLoadMoreList({
        initialArticles: [],
        initialProgress: {},
        initialHasMore: true,
        initialOffset: 0,
        fetchPage: (async () => {
          throw new Error("network");
        }) as never,
        errorMessage: "Custom load failure",
      });
    }

    useRenderLoadMoreList().loadMore();
    await flushAsyncWork();
    const after = useRenderLoadMoreList();

    assert.equal(after.loadError, "Custom load failure");
    assert.equal(after.loading, false);
  });
});

describe("keyboard shortcut hook behavior", () => {
  function installKeyWindow() {
    let listener: ((event: KeyboardEvent) => void) | null = null;
    const added: boolean[] = [];
    const removed: boolean[] = [];
    Object.assign(globalThis, {
      window: {
        addEventListener(
          type: string,
          callback: (event: KeyboardEvent) => void,
          capture?: boolean,
        ) {
          assert.equal(type, "keydown");
          listener = callback;
          added.push(Boolean(capture));
        },
        removeEventListener(
          type: string,
          callback: (event: KeyboardEvent) => void,
          capture?: boolean,
        ) {
          assert.equal(type, "keydown");
          assert.equal(callback, listener);
          removed.push(Boolean(capture));
        },
      },
    });
    return {
      added,
      removed,
      fire(event: Partial<KeyboardEvent>) {
        listener?.({
          altKey: false,
          ctrlKey: false,
          key: "",
          metaKey: false,
          target: { tagName: "BODY" },
          ...event,
        } as KeyboardEvent);
      },
    };
  }

  test("registers a shortcut with capture and cleans it up", async () => {
    const { useKeyboardShortcut } = await import("@/lib/use-keyboard-shortcut");
    const keyboard = installKeyWindow();
    let calls = 0;

    beginRender();
    useKeyboardShortcut("k", () => calls++, {
      capture: true,
      requireMeta: true,
      suppressInInput: true,
    });

    keyboard.fire({ key: "k" });
    keyboard.fire({ key: "K", ctrlKey: true });
    keyboard.fire({
      key: "k",
      ctrlKey: true,
      target: { tagName: "INPUT", isContentEditable: false } as never,
    });
    runCleanups();

    assert.equal(calls, 1);
    assert.deepEqual(keyboard.added, [true]);
    assert.deepEqual(keyboard.removed, [true]);
  });

  test("suppresses modifier collisions and skips disabled bindings", async () => {
    const { useKeyboardShortcut } = await import("@/lib/use-keyboard-shortcut");
    const keyboard = installKeyWindow();
    let calls = 0;

    beginRender();
    useKeyboardShortcut("?", () => calls++, {
      suppressOnModifiers: true,
    });
    keyboard.fire({ key: "?", altKey: true });
    keyboard.fire({ key: "/" });
    keyboard.fire({ key: "?" });

    assert.equal(calls, 1);

    resetHookStorage();
    installKeyWindow();
    beginRender();
    useKeyboardShortcut("x", () => calls++, { disabled: true });
    assert.equal(calls, 1);
  });
});

describe("focus trap hook behavior", () => {
  function installFocusDocument() {
    let listener: ((event: KeyboardEvent) => void) | null = null;
    const removed: boolean[] = [];
    const documentStub = {
      activeElement: null as HTMLElement | null,
      addEventListener(
        type: string,
        callback: (event: KeyboardEvent) => void,
        capture?: boolean,
      ) {
        assert.equal(type, "keydown");
        listener = callback;
        this.capture = Boolean(capture);
      },
      removeEventListener(
        type: string,
        callback: (event: KeyboardEvent) => void,
        capture?: boolean,
      ) {
        assert.equal(type, "keydown");
        assert.equal(callback, listener);
        removed.push(Boolean(capture));
      },
      capture: false,
    };
    Object.assign(globalThis, { document: documentStub });

    function makeEl(name: string, options: { rendered?: boolean; tabIndex?: number } = {}) {
      const el = {
        tabIndex: options.tabIndex ?? 0,
        closest: () => null,
        getClientRects: () => (options.rendered === false ? [] : [{}]),
        focus: () => {
          documentStub.activeElement = el as unknown as HTMLElement;
          focusOrder.push(name);
        },
      };
      return el as unknown as HTMLElement;
    }

    const focusOrder: string[] = [];
    return {
      documentStub,
      focusOrder,
      makeEl,
      removed,
      fire(event: Partial<KeyboardEvent>) {
        let prevented = false;
        let stopped = false;
        listener?.({
          key: "",
          preventDefault: () => {
            prevented = true;
          },
          stopImmediatePropagation: () => {
            stopped = true;
          },
          ...event,
        } as KeyboardEvent);
        return { prevented, stopped };
      },
    };
  }

  test("does nothing when inactive", async () => {
    const { useFocusTrap } = await import("@/lib/focus-trap");
    const focus = installFocusDocument();

    beginRender();
    useFocusTrap({ current: focus.makeEl("container") }, false, () => {
      assert.fail("inactive trap should not handle Escape");
    });

    assert.equal(focus.fire({ key: "Escape" }).prevented, false);
  });

  test("focuses the initial element, handles Escape, and restores opener focus", async () => {
    const { useFocusTrap } = await import("@/lib/focus-trap");
    const focus = installFocusDocument();
    const opener = focus.makeEl("opener");
    const close = focus.makeEl("close");
    const first = focus.makeEl("first");
    const container = {
      querySelectorAll: () => [first],
      focus: () => focus.focusOrder.push("container"),
    } as unknown as HTMLElement;
    focus.documentStub.activeElement = opener;
    let escapes = 0;

    beginRender();
    useFocusTrap({ current: container }, true, () => escapes++, {
      capture: true,
      initialFocusRef: { current: close },
      restoreFocus: true,
      stopEscapePropagation: true,
    });

    assert.equal(focus.focusOrder.at(-1), "close");
    const escapeResult = focus.fire({ key: "Escape" });
    runCleanups();

    assert.equal(escapes, 1);
    assert.deepEqual(escapeResult, { prevented: true, stopped: true });
    assert.equal(focus.documentStub.activeElement, opener);
    assert.deepEqual(focus.removed, [true]);
  });

  test("cycles Tab within tabbables and focuses container when none exist", async () => {
    const { useFocusTrap } = await import("@/lib/focus-trap");
    const focus = installFocusDocument();
    const first = focus.makeEl("first");
    const last = focus.makeEl("last");
    const container = {
      querySelectorAll: () => [first, last],
      focus: () => focus.focusOrder.push("container"),
    } as unknown as HTMLElement;

    beginRender();
    useFocusTrap({ current: container }, true, () => {});
    focus.documentStub.activeElement = last;
    assert.equal(focus.fire({ key: "Tab", shiftKey: false }).prevented, true);
    assert.equal(focus.focusOrder.at(-1), "first");

    focus.documentStub.activeElement = first;
    assert.equal(focus.fire({ key: "Tab", shiftKey: true }).prevented, true);
    assert.equal(focus.focusOrder.at(-1), "last");

    assert.equal(focus.fire({ key: "ArrowRight" }).prevented, false);
    runCleanups();

    const emptyFocus = installFocusDocument();
    const emptyContainer = {
      querySelectorAll: () => [],
      focus: () => emptyFocus.focusOrder.push("empty-container"),
    } as unknown as HTMLElement;
    beginRender();
    useFocusTrap({ current: emptyContainer }, true, () => {});
    assert.equal(emptyFocus.fire({ key: "Tab" }).prevented, true);
    assert.equal(emptyFocus.focusOrder.at(-1), "empty-container");
  });
});

describe("roving tabindex hook behavior", () => {
  type RovingTestEvent = {
    key: string;
    prevented: boolean;
    preventDefault: () => void;
  };

  function keyEvent(key: string) {
    const event: RovingTestEvent = {
      key,
      prevented: false,
      preventDefault() {
        event.prevented = true;
      },
    };
    return event;
  }

  test("handles Escape separately and navigates to the computed item", async () => {
    const { useRovingTabindex } = await import("@/lib/use-roving-tabindex");
    const focused: string[] = [];
    const items = ["a", "b", "c"].map((name) => ({
      focus: () => focused.push(name),
    }));
    const container = {
      querySelectorAll: (selector: string) => {
        assert.equal(selector, ".option");
        return items;
      },
    } as unknown as HTMLElement;
    const navigated: number[] = [];
    let escaped = 0;

    beginRender();
    const { handleKeyDown } = useRovingTabindex(
      { current: container },
      {
        selector: ".option",
        vertical: true,
        homeEnd: true,
        onEscape: () => escaped++,
        onNavigate: (index) => navigated.push(index),
      },
    );

    const escape = keyEvent("Escape");
    handleKeyDown(escape as never, 1);
    const arrow = keyEvent("ArrowDown");
    handleKeyDown(arrow as never, 1);
    const ignored = keyEvent("Enter");
    handleKeyDown(ignored as never, 1);

    assert.equal(escaped, 1);
    assert.equal(escape.prevented, true);
    assert.deepEqual(focused, ["c"]);
    assert.deepEqual(navigated, [2]);
    assert.equal(arrow.prevented, true);
    assert.equal(ignored.prevented, false);
  });

  test("returns without side effects when the container ref is empty", async () => {
    const { useRovingTabindex } = await import("@/lib/use-roving-tabindex");

    beginRender();
    const { handleKeyDown } = useRovingTabindex({ current: null });
    const event = keyEvent("ArrowRight");
    handleKeyDown(event as never, 0);

    assert.equal(event.prevented, false);
  });
});

describe("useCurrentReadingBlock hook behavior", () => {
  function installFakeTimers() {
    type TimerHandle = { callback: () => void; cleared: boolean };
    const handles: TimerHandle[] = [];
    globalThis.setTimeout = ((callback: () => void) => {
      const handle = { callback, cleared: false };
      handles.push(handle);
      return handle;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((handle: TimerHandle) => {
      handle.cleared = true;
    }) as unknown as typeof clearTimeout;
    return {
      handles,
      runAll() {
        for (const handle of handles.splice(0)) {
          if (!handle.cleared) handle.callback();
        }
      },
    };
  }

  test("falls back gracefully without a container or IntersectionObserver", async () => {
    const { useCurrentReadingBlock } = await import(
      "@/components/reader/useCurrentReadingBlock"
    );

    beginRender();
    assert.equal(useCurrentReadingBlock(null), null);

    beginRender();
    assert.equal(
      useCurrentReadingBlock({
        querySelectorAll: () => [],
      } as unknown as HTMLElement),
      null,
    );
  });

  test("observes block tags, debounces updates, avoids duplicate state, and cleans up", async () => {
    const { useCurrentReadingBlock } = await import(
      "@/components/reader/useCurrentReadingBlock"
    );
    const timers = installFakeTimers();
    const short = { tagName: "P", textContent: "short" };
    const best = {
      tagName: "H2",
      textContent: "This heading has enough text to count.",
    };
    const filtered = {
      tagName: "DIV",
      textContent: "This div should not be observed.",
    };
    const container = {
      querySelectorAll: () => [short, best, filtered],
    } as unknown as HTMLElement;
    let callback: (
      entries: Array<{ target: Element; intersectionRatio: number }>
    ) => void = () => assert.fail("observer callback was not installed");
    const observed: Element[] = [];
    let disconnected = false;

    class FakeIntersectionObserver {
      readonly options: IntersectionObserverInit;

      constructor(
        cb: (entries: Array<{ target: Element; intersectionRatio: number }>) => void,
        options: IntersectionObserverInit,
      ) {
        callback = cb;
        this.options = options;
        assert.ok(Array.isArray(options.threshold));
        assert.equal(options.threshold.length, 21);
      }

      observe(el: Element) {
        observed.push(el);
      }

      disconnect() {
        disconnected = true;
      }
    }

    Object.assign(globalThis, {
      IntersectionObserver: FakeIntersectionObserver,
    });

    beginRender();
    assert.equal(useCurrentReadingBlock(container), null);
    assert.deepEqual(observed, [short, best]);

    callback([
      { target: short as unknown as Element, intersectionRatio: 1 },
      { target: best as unknown as Element, intersectionRatio: 0.4 },
    ]);
    timers.runAll();
    const firstBlock = states[0] as { index: number; text: string; ratio: number };
    assert.equal(firstBlock.index, 1);
    assert.equal(firstBlock.ratio, 0.4);

    callback([{ target: best as unknown as Element, intersectionRatio: 0.4 }]);
    timers.runAll();
    assert.equal(states[0], firstBlock);

    callback([{ target: best as unknown as Element, intersectionRatio: 0 }]);
    timers.runAll();
    assert.equal(states[0], null);

    callback([{ target: best as unknown as Element, intersectionRatio: 0.7 }]);
    const cleanup = cleanups.pop();
    cleanup?.();

    assert.equal(disconnected, true);
    assert.equal(timers.handles.at(-1)?.cleared, true);
    assert.equal(states[0], null);
  });
});

describe("TTS prose highlight behavior", () => {
  type ProseWordForTest = {
    startNode: Text;
    start: number;
    endNode: Text;
    end: number;
  };

  function rangeText(
    container: HTMLElement,
    word: ProseWordForTest,
  ): string {
    if (word.startNode === word.endNode) {
      return word.startNode.textContent?.slice(word.start, word.end) ?? "";
    }
    const parts: string[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let collecting = false;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node as Text;
      const content = text.textContent ?? "";
      if (text === word.startNode) {
        collecting = true;
        parts.push(content.slice(word.start));
        continue;
      }
      if (text === word.endNode) {
        parts.push(content.slice(0, word.end));
        break;
      }
      if (collecting) parts.push(content);
    }
    return parts.join("");
  }

  function audio(overrides: Record<string, unknown> = {}) {
    return {
      activeIndex: -1,
      listenActive: false,
      plainText: "",
      words: [],
      ...overrides,
    } as never;
  }

  function installCssHighlightEnvironment(rects: Array<{ top: number; bottom: number }> = []) {
    const registry = {
      deleted: [] as string[],
      setCalls: [] as Array<{ key: string; value: unknown }>,
      delete(key: string) {
        this.deleted.push(key);
      },
      set(key: string, value: unknown) {
        this.setCalls.push({ key, value });
      },
    };

    class FakeRange {
      static throwOnSet = false;

      setStart() {
        if (FakeRange.throwOnSet) throw new Error("bad start");
      }

      setEnd() {
        if (FakeRange.throwOnSet) throw new Error("bad end");
      }

      getClientRects() {
        return rects;
      }
    }

    class FakeHighlight {
      readonly range: unknown;

      constructor(range: unknown) {
        this.range = range;
      }
    }

    Object.assign(globalThis, {
      CSS: { highlights: registry },
      Highlight: FakeHighlight,
      Range: FakeRange,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 1000,
      configurable: true,
    });

    return { FakeRange, registry };
  }

  test("buildProseWordMap falls back when offset text mismatches or spans exceed text", async () => {
    const { buildProseWordMap } = await import(
      "@/components/reader/wordLookup/useTtsProseHighlight"
    );
    const document = installDom("<div id='prose'>Hello world</div>");
    const prose = document.getElementById("prose") as HTMLElement;

    const mismatch = buildProseWordMap(
      prose,
      [{ word: "Hello", textStart: 0, textEnd: 5 }],
      "Hxllo world",
    );
    const outOfRange = buildProseWordMap(
      prose,
      [{ word: "world", textStart: 6, textEnd: 99 }],
      "Hello world",
    );

    assert.equal(rangeText(prose, mismatch[0]!), "Hello");
    assert.equal(rangeText(prose, outOfRange[0]!), "world");
    assert.deepEqual(buildProseWordMap(prose, [], "Hello world"), []);
  });

  test("clears map without prose or words and exits when CSS highlights are unavailable", async () => {
    const { useTtsProseHighlight } = await import(
      "@/components/reader/wordLookup/useTtsProseHighlight"
    );

    beginRender();
    useTtsProseHighlight({ current: null }, audio({ words: [] }), []);

    assert.deepEqual((refs[0] as { current: unknown[] }).current, []);
  });

  test("deletes stale CSS highlights for inactive or unmapped active words", async () => {
    const { useTtsProseHighlight } = await import(
      "@/components/reader/wordLookup/useTtsProseHighlight"
    );
    const document = installDom("<div id='prose'>Hello</div>");
    const prose = document.getElementById("prose") as HTMLElement;
    const { registry } = installCssHighlightEnvironment();

    beginRender();
    useTtsProseHighlight(
      { current: prose },
      audio({
        activeIndex: -1,
        plainText: "Hello",
        words: [{ word: "Hello", textStart: 0, textEnd: 5 }],
      }),
      [],
    );
    assert.deepEqual(registry.deleted, ["tts-active"]);

    resetHookStorage();
    const second = installCssHighlightEnvironment();
    beginRender();
    useTtsProseHighlight(
      { current: prose },
      audio({
        activeIndex: 0,
        plainText: "Hello",
        words: [{ word: "Missing" }],
      }),
      [],
    );
    assert.deepEqual(second.registry.deleted, ["tts-active"]);
  });

  test("deletes CSS highlight when Range construction fails", async () => {
    const { useTtsProseHighlight } = await import(
      "@/components/reader/wordLookup/useTtsProseHighlight"
    );
    const document = installDom("<div id='prose'>Hello</div>");
    const prose = document.getElementById("prose") as HTMLElement;
    const { FakeRange, registry } = installCssHighlightEnvironment();
    FakeRange.throwOnSet = true;

    beginRender();
    useTtsProseHighlight(
      { current: prose },
      audio({
        activeIndex: 0,
        plainText: "Hello",
        words: [{ word: "Hello", textStart: 0, textEnd: 5 }],
      }),
      [],
    );

    assert.deepEqual(registry.deleted, ["tts-active"]);
  });

  test("sets the active CSS highlight, scrolls while listening, and cleans up", async () => {
    const { useTtsProseHighlight } = await import(
      "@/components/reader/wordLookup/useTtsProseHighlight"
    );
    const document = installDom("<div id='prose'>Hello</div>");
    const prose = document.getElementById("prose") as HTMLElement & {
      scrollIntoView?: (options: ScrollIntoViewOptions) => void;
    };
    let scrollOptions: ScrollIntoViewOptions | null = null;
    prose.scrollIntoView = (options) => {
      scrollOptions = typeof options === "object" ? options : null;
    };
    const { registry } = installCssHighlightEnvironment([
      { top: 10, bottom: 40 },
    ]);

    beginRender();
    useTtsProseHighlight(
      { current: prose },
      audio({
        activeIndex: 0,
        listenActive: true,
        plainText: "Hello",
        words: [{ word: "Hello", textStart: 0, textEnd: 5 }],
      }),
      [],
    );
    runCleanups();

    assert.equal(registry.setCalls[0]?.key, "tts-active");
    assert.deepEqual(scrollOptions, { behavior: "smooth", block: "center" });
    assert.deepEqual(registry.deleted, ["tts-active"]);
  });
});
