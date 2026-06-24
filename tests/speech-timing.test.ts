import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildTokenAlignment,
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