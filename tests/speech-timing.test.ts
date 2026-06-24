import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  alignReadingXTimingsToSpeechWords,
  buildTokenAlignment,
  extractTextTokens,
} from "@/lib/speech-timing";

describe("speech timing alignment", () => {
  test("converts ReadingX millisecond timings to ReadWise text ranges and seconds", () => {
    const spokenText = "Japan's growth won 1st Place.";

    const words = alignReadingXTimingsToSpeechWords(spokenText, [
      { word: "Japan", offset: 0, duration: 250 },
      { word: "growth", offset: 250, duration: 300 },
      { word: "1st Place", offset: 550, duration: 450 },
    ]);

    assert.deepEqual(words, [
      { textOffset: 0, length: 7, start: 0, end: 0.25 },
      { textOffset: 8, length: 6, start: 0.25, end: 0.55 },
      { textOffset: 19, length: 9, start: 0.55, end: 1 },
    ]);
  });

  test("keeps aligning after an unmatched ReadingX word", () => {
    const words = alignReadingXTimingsToSpeechWords("Hello world again", [
      { word: "missing", offset: 0, duration: 100 },
      { word: "world", offset: 100, duration: 200 },
      { word: "again", offset: 300, duration: 200 },
    ]);

    assert.deepEqual(words, [
      { textOffset: 6, length: 5, start: 0.1, end: 0.3 },
      { textOffset: 12, length: 5, start: 0.3, end: 0.5 },
    ]);
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