import { test } from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { legacySpeechWordsToTimingPayloadV2 } from "@/lib/speech";
import {
  parseStoredSpeechTimingPayload,
  parseStoredSpeechWords,
} from "@/lib/speech/repository";

function assertRejectsStoredSpeechWords(value: Prisma.JsonValue | null | undefined): void {
  assert.equal(parseStoredSpeechWords(value), null);
}

function assertRejectsStoredTimingPayload(value: Prisma.JsonValue | null | undefined): void {
  assert.equal(parseStoredSpeechTimingPayload(value), null);
}

test("parseStoredSpeechWords accepts legacy arrays and normalizes timings", () => {
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

test("legacySpeechWordsToTimingPayloadV2 converts legacy arrays to canonical V2", () => {
  assert.deepEqual(
    legacySpeechWordsToTimingPayloadV2(
      [
        { word: "world", offset: 500, duration: 200, textOffset: 6, wordLength: 5 },
        { word: "Hello", offset: 0, duration: 500, textOffset: 0, wordLength: 5 },
      ],
      "azure",
    ),
    {
      version: 2,
      provider: "azure",
      timeUnit: "ms",
      textUnit: "utf16",
      words: ["Hello", "world"],
      startMs: [0, 500],
      endMs: [500, 700],
      textStart: [0, 6],
      textEnd: [5, 11],
    },
  );
});

test("parseStoredSpeechWords rejects malformed timing shapes", () => {
  assertRejectsStoredSpeechWords("not json");
  assertRejectsStoredSpeechWords({});
  assertRejectsStoredSpeechWords([{ word: "Hello", offset: 100, duration: -1 }]);
  assertRejectsStoredSpeechWords([
    { textOffset: 0, length: 4, start: 0, end: 0.5 },
  ]);
  assertRejectsStoredSpeechWords([
    { word: "Hello", offset: 0, duration: 500, textOffset: 0 },
  ]);
  assertRejectsStoredSpeechWords([
    { word: "Hello", offset: 0, duration: 500, wordLength: 5 },
  ]);
  assertRejectsStoredSpeechWords([
    { word: "Hello", offset: 0, duration: 500, textOffset: null, wordLength: 5 },
  ]);
});

test("parseStoredSpeechTimingPayload rejects malformed V2 payloads", () => {
  assertRejectsStoredTimingPayload({
    version: 1,
    provider: "azure",
    timeUnit: "ms",
    textUnit: "utf16",
    words: [{ word: "Hello", offset: 0, duration: 500 }],
  });
  assertRejectsStoredTimingPayload({
    version: 2,
    provider: "azure",
    timeUnit: "ms",
    textUnit: "utf16",
    words: ["Hello"],
    startMs: [0],
    endMs: [],
  });
  assertRejectsStoredTimingPayload({
    version: 2,
    provider: "azure",
    timeUnit: "seconds",
    textUnit: "utf16",
    words: ["Hello"],
    startMs: [0],
    endMs: [500],
  });
  assertRejectsStoredTimingPayload({
    version: 2,
    provider: "azure",
    timeUnit: "ms",
    textUnit: "utf16",
    words: ["Hello"],
    startMs: [600],
    endMs: [500],
  });
});
