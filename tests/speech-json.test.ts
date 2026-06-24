import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStoredSpeechWords } from "@/lib/speech";

test("parseStoredSpeechWords accepts empty and non-empty Json arrays", () => {
  assert.deepEqual(parseStoredSpeechWords([]), []);
  assert.deepEqual(
    parseStoredSpeechWords([{ word: "Hello", offset: 0, duration: 500 }]),
    [{ word: "Hello", offset: 0, duration: 500 }],
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
    parseStoredSpeechWords(
      [
        { textOffset: 0, length: 5, start: 0, end: 0.5 },
        { word: "world", offset: 500, duration: 200 },
      ],
    ),
    null,
  );
});
