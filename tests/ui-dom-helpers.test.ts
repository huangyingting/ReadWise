process.env.LOG_LEVEL = "error";

import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import {
  applyHighlightMarks,
  collectTextNodes,
  computeAnchor,
  findBestAnchor,
  overlapsAny,
} from "@/components/reader/wordLookup/highlightMarks";
import {
  extractContextSentence,
  wordAtPoint,
} from "@/components/reader/wordLookup/selectionHelpers";
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
  type Theme,
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
  const textPrototype = Object.getPrototypeOf(document.createTextNode("x")) as {
    splitText?: (offset: number) => Text;
  };
  if (typeof textPrototype.splitText !== "function") {
    Object.defineProperty(textPrototype, "splitText", {
      configurable: true,
      value(this: Text, offset: number) {
        const content = this.textContent ?? "";
        this.textContent = content.slice(0, offset);
        const next = document.createTextNode(content.slice(offset));
        this.parentNode?.insertBefore(next, this.nextSibling);
        return next;
      },
    });
  }
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

describe("selection helpers", () => {
  test("wordAtPoint uses caretRangeFromPoint and keeps apostrophes and hyphens", () => {
    const document = installDom("<p id='p'>well-being isn't simple</p>");
    const text = document.getElementById("p")!.firstChild as Text;

    (
      document as Document & { caretRangeFromPoint?: () => Range }
    ).caretRangeFromPoint = () =>
      ({
        startContainer: text,
        startOffset: 5,
      }) as unknown as Range;

    assert.equal(wordAtPoint(10, 20), "well-being");
  });

  test("wordAtPoint falls back to caretPositionFromPoint", () => {
    const document = installDom("<p id='p'>alpha beta gamma</p>");
    const text = document.getElementById("p")!.firstChild as Text;
    const doc = document as unknown as {
      caretRangeFromPoint?: undefined;
      caretPositionFromPoint?: () => { offsetNode: Node; offset: number };
    };
    doc.caretRangeFromPoint = undefined;
    doc.caretPositionFromPoint = () => ({ offsetNode: text, offset: 8 });

    assert.equal(wordAtPoint(1, 2), "beta");
  });

  test("wordAtPoint returns null for non-text nodes or empty word spans", () => {
    const document = installDom("<p id='p'>   </p>");
    const paragraph = document.getElementById("p")!;
    const text = paragraph.firstChild as Text;
    const doc = document as unknown as {
      caretRangeFromPoint?: () => Range;
    };

    doc.caretRangeFromPoint = () =>
      ({
        startContainer: paragraph,
        startOffset: 0,
      }) as unknown as Range;
    assert.equal(wordAtPoint(0, 0), null);

    doc.caretRangeFromPoint = () =>
      ({
        startContainer: text,
        startOffset: 1,
      }) as unknown as Range;
    assert.equal(wordAtPoint(0, 0), null);
  });

  test("extractContextSentence returns null for overlong matching fragments", () => {
    const prose = {
      textContent: `${"word ".repeat(90)}. A concise sentence follows.`,
    } as HTMLElement;

    assert.equal(extractContextSentence(prose, "word"), null);
  });
});

describe("highlight mark helpers", () => {
  type HighlightInput = Parameters<typeof applyHighlightMarks>[1][number];

  function highlight(overrides: Partial<HighlightInput>): HighlightInput {
    return {
      id: "hl",
      quote: "quote",
      startOffset: 0,
      endOffset: 5,
      prefix: "",
      suffix: "",
      color: "yellow",
      ...overrides,
    } as HighlightInput;
  }

  test("findBestAnchor prefers the occurrence with the strongest context", () => {
    const fullText = "alpha quote omega beta quote gamma";

    assert.equal(findBestAnchor(fullText, "", "alpha ", " omega"), -1);
    assert.equal(
      findBestAnchor(fullText, "quote", "beta ", " gamma"),
      fullText.lastIndexOf("quote"),
    );
    assert.equal(
      findBestAnchor(fullText, "quote", "alpha beta", "omega gamma"),
      fullText.indexOf("quote"),
    );
  });

  test("computeAnchor captures quote offsets and context from a selection", () => {
    const document = installDom(
      "<div id='prose'>Lead prefix <strong>chosen quote</strong> suffix tail</div>",
    );
    const prose = document.getElementById("prose") as HTMLElement;
    const text = prose.querySelector("strong")!.firstChild as Text;
    const range = {
      startContainer: text,
      startOffset: 0,
      cloneRange: () => ({
        selectNodeContents: (node: Node) => assert.equal(node, prose),
        setEnd: (node: Node, offset: number) => {
          assert.equal(node, text);
          assert.equal(offset, 0);
        },
        toString: () => "Lead prefix ",
      }),
      toString: () => "chosen quote",
    } as unknown as Range;
    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => range.toString(),
    } as unknown as Selection;

    const anchor = computeAnchor(prose, selection);

    assert.deepEqual(anchor, {
      quote: "chosen quote",
      startOffset: "Lead prefix ".length,
      endOffset: "Lead prefix chosen quote".length,
      prefix: "Lead prefix ",
      suffix: " suffix tail",
    });
  });

  test("computeAnchor rejects collapsed, missing, or whitespace-only selections", () => {
    const document = installDom("<div id='prose'>Text</div>");
    const prose = document.getElementById("prose") as HTMLElement;
    const range = document.createRange();

    assert.equal(
      computeAnchor(prose, {
        isCollapsed: true,
        rangeCount: 1,
        getRangeAt: () => range,
        toString: () => "Text",
      } as unknown as Selection),
      null,
    );
    assert.equal(
      computeAnchor(prose, {
        isCollapsed: false,
        rangeCount: 0,
        getRangeAt: () => range,
        toString: () => "Text",
      } as unknown as Selection),
      null,
    );
    assert.equal(
      computeAnchor(prose, {
        isCollapsed: false,
        rangeCount: 1,
        getRangeAt: () => range,
        toString: () => "   ",
      } as unknown as Selection),
      null,
    );
  });

  test("collectTextNodes returns DOM-order offsets across nested text nodes", () => {
    const document = installDom("<div id='prose'>One <em>two</em> three</div>");
    const prose = document.getElementById("prose") as HTMLElement;

    const entries = collectTextNodes(prose);

    assert.deepEqual(
      entries.map((entry) => ({
        text: entry.node.textContent,
        start: entry.start,
        end: entry.end,
      })),
      [
        { text: "One ", start: 0, end: 4 },
        { text: "two", start: 4, end: 7 },
        { text: " three", start: 7, end: 13 },
      ],
    );
  });

  test("applyHighlightMarks wraps exact multi-node matches and marks note metadata once", () => {
    const document = installDom(
      "<div id='prose'>Hello <em>wonderful world</em> again</div>",
    );
    const prose = document.getElementById("prose") as HTMLElement;

    applyHighlightMarks(
      prose,
      [
        highlight({
          id: "note",
          quote: "Hello wonderful",
          startOffset: 0,
          endOffset: "Hello wonderful".length,
          color: "green",
          note: "remember this",
        }),
      ],
      () => assert.fail("highlight should resolve"),
    );

    const marks = Array.from(prose.querySelectorAll<HTMLElement>("mark.rw-hl"));
    assert.equal(marks.length, 2);
    assert.deepEqual(
      marks.map((mark) => [mark.dataset.hlId, mark.dataset.hlColor]),
      [
        ["note", "green"],
        ["note", "green"],
      ],
    );
    assert.equal(prose.querySelectorAll(".sr-only").length, 1);
  });

  test("applyHighlightMarks unwraps old marks and handles no-highlight input", () => {
    const document = installDom("<div id='prose'>Alpha beta gamma</div>");
    const prose = document.getElementById("prose") as HTMLElement;
    const original = prose.textContent;

    applyHighlightMarks(
      prose,
      [
        highlight({
          id: "plain",
          quote: "beta",
          startOffset: 6,
          endOffset: 10,
          color: undefined,
        }),
      ],
      () => assert.fail("highlight should resolve"),
    );
    assert.equal(prose.querySelectorAll("mark.rw-hl").length, 1);

    applyHighlightMarks(prose, [], () => assert.fail("no orphan checks"));

    assert.equal(prose.querySelectorAll("mark.rw-hl").length, 0);
    assert.equal(prose.textContent, original);
  });

  test("applyHighlightMarks repairs stale offsets and reports orphaned highlights", () => {
    const document = installDom(
      "<div id='prose'>Alpha world omega beta world gamma</div>",
    );
    const prose = document.getElementById("prose") as HTMLElement;
    const orphaned: string[] = [];

    applyHighlightMarks(
      prose,
      [
        highlight({
          id: "repair",
          quote: "world",
          startOffset: 0,
          endOffset: 5,
          prefix: "beta ",
          suffix: " gamma",
        }),
        highlight({
          id: "missing",
          quote: "absent",
          startOffset: 0,
          endOffset: 6,
        }),
      ],
      (id) => orphaned.push(id),
    );

    assert.deepEqual(orphaned, ["missing"]);
    const mark = prose.querySelector<HTMLElement>("mark.rw-hl")!;
    assert.equal(mark.dataset.hlId, "repair");
    assert.equal(mark.textContent, "world");
  });

  test("applyHighlightMarks ignores zero-length resolved segments", () => {
    const document = installDom("<div id='prose'>Alpha</div>");
    const prose = document.getElementById("prose") as HTMLElement;

    applyHighlightMarks(
      prose,
      [
        highlight({
          id: "empty",
          quote: "",
          startOffset: 1,
          endOffset: 1,
        }),
      ],
      () => assert.fail("empty exact range should not orphan"),
    );

    assert.equal(prose.querySelectorAll("mark.rw-hl").length, 0);
  });

  test("overlapsAny excludes optimistic highlights and honors half-open ranges", () => {
    const matches = overlapsAny(10, 20, [
      highlight({ id: "left", startOffset: 0, endOffset: 10 }),
      highlight({ id: "right", startOffset: 20, endOffset: 30 }),
      highlight({ id: "hit", startOffset: 19, endOffset: 21 }),
      highlight({ id: "optimistic-new", startOffset: 12, endOffset: 18 }),
    ]);

    assert.deepEqual(
      matches.map((match) => match.id),
      ["hit"],
    );
  });
});
