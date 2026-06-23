import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStoredSpeechWords } from "@/lib/speech";

test("parseStoredSpeechWords accepts empty and non-empty Json arrays", () => {
  assert.deepEqual(parseStoredSpeechWords([]), []);
  assert.deepEqual(
    parseStoredSpeechWords([{ textOffset: 0, length: 4, start: 0, end: 0.5 }]),
    [{ textOffset: 0, length: 4, start: 0, end: 0.5 }],
  );
});

test("parseStoredSpeechWords remains compatible with legacy JSON strings", () => {
  assert.deepEqual(
    parseStoredSpeechWords(
      JSON.stringify([{ textOffset: 1, length: 5, start: 0.2, end: 0.7 }]),
    ),
    [{ textOffset: 1, length: 5, start: 0.2, end: 0.7 }],
  );
});

test("parseStoredSpeechWords rejects malformed timing shapes", () => {
  assert.equal(parseStoredSpeechWords("not json"), null);
  assert.equal(parseStoredSpeechWords({}), null);
  assert.equal(
    parseStoredSpeechWords([{ textOffset: 0, length: 4, start: 1, end: 0.5 }]),
    null,
  );
});
