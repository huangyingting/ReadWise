/**
 * Tests for pure DOM/selection helpers in the WordLookup subsystem.
 *
 * These functions are React-free and can be tested against plain mock objects
 * without a real DOM framework.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  extractContextSentence,
  wordAtPoint,
} from "@/components/reader/wordLookup/selectionHelpers";

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
