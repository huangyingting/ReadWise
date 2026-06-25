import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildTokenAlignment,
  extractSpeechBoundaryTokens,
  extractTextTokens,
  timingEndSeconds,
  timingStartSeconds,
} from "@/lib/speech-timing";

describe("speech timing alignment", () => {
  test("aligns word timings to text tokens", () => {
    const textTokens = extractTextTokens("Japan's growth won 1st Place.");
    const { alignment, spanLengths } = buildTokenAlignment(textTokens, [
      { word: "Japan" },
      { word: "growth" },
      { word: "1st Place" },
    ]);

    assert.deepEqual(alignment, [0, 1, 3]);
    assert.deepEqual(spanLengths, [1, 1, 2]);
  });

  test("keeps aligning after an unmatched word timing", () => {
    const textTokens = extractTextTokens("Hello world again");
    const { alignment } = buildTokenAlignment(textTokens, [
      { word: "missing" },
      { word: "world" },
      { word: "again" },
    ]);

    assert.deepEqual(alignment, [null, 1, 2]);
  });

  test("does not jump to a far repeated token after an unmatched timing", () => {
    const filler = Array.from({ length: 20 }, (_, i) => `filler${i}`).join(" ");
    const textTokens = extractTextTokens(`alpha beta gamma ${filler} outlier`);
    const { alignment } = buildTokenAlignment(textTokens, [
      { word: "outlier" },
      { word: "beta" },
      { word: "gamma" },
    ]);

    assert.deepEqual(alignment, [null, 1, 2]);
  });

  test("uses a later repeated token when following timings confirm it", () => {
    const filler = Array.from({ length: 12 }, (_, i) => `filler${i}`).join(" ");
    const textTokens = extractTextTokens(`common ${filler} common next after`);
    const { alignment } = buildTokenAlignment(textTokens, [
      { word: "common" },
      { word: "next" },
      { word: "after" },
    ]);

    assert.deepEqual(alignment, [13, 14, 15]);
  });

  test("skips punctuation-only timing boundaries", () => {
    const textTokens = extractTextTokens("Hello, world.");
    const { alignment } = buildTokenAlignment(textTokens, [
      { word: "Hello" },
      { word: "," },
      { word: "world" },
      { word: "." },
    ]);

    assert.deepEqual(alignment, [0, null, 1, null]);
  });

  test("aligns punctuation boundaries when speech boundary tokens are used", () => {
    const speechTokens = extractSpeechBoundaryTokens("Hello, world.");
    const { alignment } = buildTokenAlignment(speechTokens, [
      { word: "Hello" },
      { word: "," },
      { word: "world" },
      { word: "." },
    ]);

    assert.deepEqual(alignment, [0, 1, 2, 3]);
  });

  test("aligns compact punctuation timing entries across adjacent punctuation tokens", () => {
    const speechTokens = extractSpeechBoundaryTokens("Wait... now.");
    const { alignment, spanLengths } = buildTokenAlignment(speechTokens, [
      { word: "Wait" },
      { word: "..." },
      { word: "now" },
      { word: "." },
    ]);

    assert.deepEqual(alignment, [0, 1, 4, 5]);
    assert.deepEqual(spanLengths, [1, 3, 1, 1]);
  });

  test("matches compact dotted timing entries across adjacent tokens", () => {
    const textTokens = extractTextTokens("Character AI launched updates.");
    const { alignment, spanLengths } = buildTokenAlignment(textTokens, [
      { word: "Character.AI" },
      { word: "launched" },
    ]);

    assert.deepEqual(alignment, [0, 2]);
    assert.deepEqual(spanLengths, [2, 1]);
  });

  test("matches compact dotted timing entries including punctuation token", () => {
    const speechTokens = extractSpeechBoundaryTokens("Character.AI launched updates.");
    const { alignment, spanLengths } = buildTokenAlignment(speechTokens, [
      { word: "Character.AI" },
      { word: "launched" },
    ]);

    assert.deepEqual(alignment, [0, 3]);
    assert.deepEqual(spanLengths, [3, 1]);
  });

  test("converts millisecond timings to seconds", () => {
    const timing = { word: "Hello", offset: 1250, duration: 375 };
    assert.equal(timingStartSeconds(timing), 1.25);
    assert.equal(timingEndSeconds(timing), 1.625);
  });

  test("supports possessive matching in both directions", () => {
    const textTokens = extractTextTokens("China and Japan's markets");
    const { alignment } = buildTokenAlignment(textTokens, [
      { word: "China's" },
      { word: "Japan" },
      { word: "markets" },
    ]);

    assert.deepEqual(alignment, [0, 2, 3]);
  });
});