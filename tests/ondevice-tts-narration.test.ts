/**
 * On-device narration adapters: aligned words → Reader speech words, and
 * PCM/WAV encoding for the shared <audio> element.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeWav, floatToPcm16, toSpeechWords } from "@/lib/ondevice-tts/narration";
import type { WordTimestamp } from "@/lib/ondevice-tts/types";

function word(text: string, charStart: number, startMs: number, endMs: number): WordTimestamp {
  return { text, charStart, charEnd: charStart + text.length, startMs, endMs, chunkIndex: 0, wordIndex: 0 };
}

test("toSpeechWords trims punctuation from highlight spans and drops punctuation-only tokens", () => {
  const text = `He said, "China." — then “left”`;
  const words = toSpeechWords([
    word("He", 0, 0, 100),
    word("said,", 3, 100, 300),
    word(`"China."`, 9, 300, 700),
    word("—", 18, 700, 700),
    word("then", 20, 700, 900),
    word("“left”", 25, 900, 1200),
  ]);
  assert.deepEqual(
    words.map((w) => [w.word, text.slice(w.textStart, w.textEnd), w.startMs, w.endMs]),
    [
      ["He", "He", 0, 100],
      ["said", "said", 100, 300],
      ["China", "China", 300, 700],
      ["then", "then", 700, 900],
      ["left", "left", 900, 1200],
    ],
  );
});

test("toSpeechWords keeps inner apostrophes and never produces negative durations", () => {
  const [w] = toSpeechWords([word("isn't", 4, 500, 450)]);
  assert.deepEqual(w, { word: "isn't", startMs: 500, endMs: 500, textStart: 4, textEnd: 9 });
});

test("floatToPcm16 clamps and scales samples", () => {
  assert.deepEqual(Array.from(floatToPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5]))), [
    0, 32767, -32768, 32767, -32768, 16383,
  ]);
});

test("encodeWav writes a mono 16-bit PCM header followed by all chunks", async () => {
  const blob = encodeWav([new Int16Array([1, 2]), new Int16Array([3])], 24_000);
  assert.equal(blob.type, "audio/wav");
  const bytes = new DataView(await blob.arrayBuffer());
  const ascii = (offset: number) =>
    String.fromCharCode(...[0, 1, 2, 3].map((i) => bytes.getUint8(offset + i)));
  assert.equal(ascii(0), "RIFF");
  assert.equal(ascii(8), "WAVE");
  assert.equal(bytes.getUint16(22, true), 1); // mono
  assert.equal(bytes.getUint32(24, true), 24_000);
  assert.equal(bytes.getUint16(34, true), 16);
  assert.equal(ascii(36), "data");
  assert.equal(bytes.getUint32(40, true), 6);
  assert.deepEqual([bytes.getInt16(44, true), bytes.getInt16(46, true), bytes.getInt16(48, true)], [1, 2, 3]);
});
