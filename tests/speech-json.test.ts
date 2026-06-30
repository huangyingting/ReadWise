import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseStoredSpeechTimingPayload,
  parseStoredSpeechWords,
} from "@/lib/speech/repository";

test("parseStoredSpeechWords accepts legacy V1 arrays and normalizes timings", () => {
  assert.deepEqual(parseStoredSpeechWords([]), []);
  assert.deepEqual(
    parseStoredSpeechWords([{ word: "Hello", offset: 0, duration: 500 }]),
    [{ word: "Hello", startMs: 0, endMs: 500 }],
  );
  assert.deepEqual(
    parseStoredSpeechWords([
      { word: "world", offset: 500, duration: 200, textOffset: 6, wordLength: 5 },
      { word: "Hello", offset: 0, duration: 500, textOffset: 0, wordLength: 5 },
    ]),
    [
      { word: "Hello", startMs: 0, endMs: 500, textStart: 0, textEnd: 5 },
      { word: "world", startMs: 500, endMs: 700, textStart: 6, textEnd: 11 },
    ],
  );
});

test("parseStoredSpeechTimingPayload accepts versioned V1 objects", () => {
  assert.deepEqual(
    parseStoredSpeechTimingPayload({
      version: 1,
      provider: "azure",
      timeUnit: "ms",
      textUnit: "utf16",
      words: [{ word: "Hello", offset: 0, duration: 500 }],
    }),
    {
      version: 1,
      provider: "azure",
      timeUnit: "ms",
      textUnit: "utf16",
      words: [{ word: "Hello", startMs: 0, endMs: 500 }],
    },
  );
});

test("parseStoredSpeechTimingPayload accepts versioned V2 columnar payloads", () => {
  assert.deepEqual(
    parseStoredSpeechTimingPayload({
      version: 2,
      provider: "azure",
      timeUnit: "ms",
      textUnit: "utf16",
      words: ["Hello", "world"],
      startMs: [0, 500],
      endMs: [400, 900],
      textStart: [0, 6],
      textEnd: [5, 11],
    }),
    {
      version: 2,
      provider: "azure",
      timeUnit: "ms",
      textUnit: "utf16",
      words: [
        { word: "Hello", startMs: 0, endMs: 400, textStart: 0, textEnd: 5 },
        { word: "world", startMs: 500, endMs: 900, textStart: 6, textEnd: 11 },
      ],
    },
  );
});

test("parseStoredSpeechWords rejects malformed timing shapes", () => {
  assert.equal(parseStoredSpeechWords("not json"), null);
  assert.equal(parseStoredSpeechWords({}), null);
  assert.equal(
    parseStoredSpeechWords([{ word: "Hello", offset: 100, duration: -1 }]),
    null,
  );
  assert.equal(
    parseStoredSpeechWords([{ textOffset: 0, length: 4, start: 0, end: 0.5 }]),
    null,
  );
  assert.equal(
    parseStoredSpeechWords([{ word: "Hello", offset: 0, duration: 500, textOffset: 0 }]),
    null,
  );
  assert.equal(
    parseStoredSpeechWords([{ word: "Hello", offset: 0, duration: 500, wordLength: 5 }]),
    null,
  );
  assert.equal(
    parseStoredSpeechWords([
      { word: "Hello", offset: 0, duration: 500, textOffset: null, wordLength: 5 },
    ]),
    null,
  );
});

test("parseStoredSpeechTimingPayload rejects malformed V2 payloads", () => {
  assert.equal(
    parseStoredSpeechTimingPayload({
      version: 2,
      provider: "azure",
      timeUnit: "ms",
      textUnit: "utf16",
      words: ["Hello"],
      startMs: [0],
      endMs: [],
    }),
    null,
  );
  assert.equal(
    parseStoredSpeechTimingPayload({
      version: 2,
      provider: "azure",
      timeUnit: "seconds",
      textUnit: "utf16",
      words: ["Hello"],
      startMs: [0],
      endMs: [500],
    }),
    null,
  );
  assert.equal(
    parseStoredSpeechTimingPayload({
      version: 2,
      provider: "azure",
      timeUnit: "ms",
      textUnit: "utf16",
      words: ["Hello"],
      startMs: [600],
      endMs: [500],
    }),
    null,
  );
});
