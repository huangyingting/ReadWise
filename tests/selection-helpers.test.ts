/**
 * Tests for pure DOM/selection helpers in the WordLookup subsystem.
 *
 * These functions are React-free and can be tested against plain mock objects
 * without a real DOM framework.
 */

import { afterEach, test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  extractContextSentence,
  wordAtPoint,
} from "@/components/reader/wordLookup/selectionHelpers";

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

afterEach(() => {
  restoreGlobals();
});

// ---------------------------------------------------------------------------
// extractContextSentence
// ---------------------------------------------------------------------------

describe("extractContextSentence", () => {
  function el(textContent: string): HTMLElement {
    return { textContent } as unknown as HTMLElement;
  }

  test("returns the sentence containing the word", () => {
    const prose = el("The cat sat on the mat. The dog barked loudly. A bird flew away.");
    assert.equal(
      extractContextSentence(prose, "dog"),
      "The dog barked loudly.",
    );
  });

  test("is case-insensitive for the word match", () => {
    const prose = el("She went to Paris. He stayed home.");
    assert.equal(extractContextSentence(prose, "paris"), "She went to Paris.");
  });

  test("returns null when the word is not found", () => {
    const prose = el("Hello world. Goodbye moon.");
    assert.equal(extractContextSentence(prose, "zebra"), null);
  });

  test("returns null for empty text content", () => {
    const prose = el("");
    assert.equal(extractContextSentence(prose, "word"), null);
  });

  test("returns null for empty word", () => {
    const prose = el("Some text here.");
    assert.equal(extractContextSentence(prose, ""), null);
  });

  test("skips sentences longer than 400 characters", () => {
    const long = "word " + "x".repeat(396);
    const prose = el(`${long}. Short sentence with word.`);
    // The long sentence is >400 chars and should be skipped; the short one returned.
    assert.equal(
      extractContextSentence(prose, "word"),
      "Short sentence with word.",
    );
  });

  test("handles text with no sentence-ending punctuation", () => {
    const prose = el("Just some words with word in them");
    assert.equal(
      extractContextSentence(prose, "word"),
      "Just some words with word in them",
    );
  });

  test("handles question and exclamation marks as sentence boundaries", () => {
    const prose = el("Are you sure? Yes I am! The cat runs fast.");
    assert.equal(extractContextSentence(prose, "sure"), "Are you sure?");
    assert.equal(extractContextSentence(prose, "am"), "Yes I am!");
  });

  test("returns the trimmed sentence", () => {
    const prose = el("  Leading spaces. Word is here. Trailing.");
    const result = extractContextSentence(prose, "here");
    assert.ok(result !== null && result === result.trim());
  });

  test("returns null when textContent is null", () => {
    const prose = { textContent: null } as unknown as HTMLElement;
    assert.equal(extractContextSentence(prose, "word"), null);
  });
});

// ---------------------------------------------------------------------------
// wordAtPoint — DOM-dependent, tested for graceful degradation in Node.js
// ---------------------------------------------------------------------------

describe("wordAtPoint", () => {
  test("returns null when document caret APIs are unavailable", () => {
    // In Node.js there is no DOM, so both caret APIs are absent.
    // The function must return null gracefully rather than throwing.
    assert.equal(wordAtPoint(0, 0), null);
  });
});

describe("wordAtPoint DOM caret APIs", () => {
  test("uses caretRangeFromPoint and keeps apostrophes and hyphens", () => {
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

  test("falls back to caretPositionFromPoint", () => {
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

  test("returns null for non-text nodes or empty word spans", () => {
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
});

describe("extractContextSentence length guard", () => {
  test("returns null for overlong matching fragments", () => {
    const prose = {
      textContent: `${"word ".repeat(90)}. A concise sentence follows.`,
    } as HTMLElement;

    assert.equal(extractContextSentence(prose, "word"), null);
  });
});
