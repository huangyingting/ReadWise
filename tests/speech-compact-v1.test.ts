/**
 * Compact V1 speech timing — contract and regression tests.
 *
 * Verifies:
 * - Legacy unversioned arrays parse identically to current behavior.
 * - Compact V1 parses to the same normalized SpeechWord values.
 * - Compact V1 serializer emits the exact columnar shape.
 * - Mismatched arrays, invalid times, end<start, and malformed values reject.
 * - V2 serializer output is byte/deep-equal unchanged.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseSpeechTimingPayload,
  createSpeechTimingPayloadV1,
  createSpeechTimingPayloadV2,
  legacySpeechWordsToTimingPayloadV1,
  legacySpeechWordsToTimingPayloadV2,
} from "@/lib/speech/timing-storage";
import type { SpeechWord } from "@/lib/speech/timing";

// ── Shared fixture ────────────────────────────────────────────────────────────

const LEGACY_ARRAY = [
  { word: "Hello", offset: 0, duration: 400, textOffset: 0, wordLength: 5 },
  { word: "world", offset: 500, duration: 200, textOffset: 6, wordLength: 5 },
];

const NORMALIZED_WORDS: SpeechWord[] = [
  { word: "Hello", startMs: 0, endMs: 400, textStart: 0, textEnd: 5 },
  { word: "world", startMs: 500, endMs: 700, textStart: 6, textEnd: 11 },
];

const NORMALIZED_PAYLOAD = {
  version: 2 as const,
  provider: "unknown",
  timeUnit: "ms" as const,
  textUnit: "utf16" as const,
  words: NORMALIZED_WORDS,
};

// ── Legacy unversioned array ──────────────────────────────────────────────────

describe("legacy unversioned arrays", () => {
  test("parse to normalized V2 runtime contract (unchanged behavior)", () => {
    assert.deepEqual(parseSpeechTimingPayload(LEGACY_ARRAY), NORMALIZED_PAYLOAD);
  });

  test("empty array produces empty words list", () => {
    assert.deepEqual(parseSpeechTimingPayload([]), {
      version: 2,
      provider: "unknown",
      timeUnit: "ms",
      textUnit: "utf16",
      words: [],
    });
  });

  test("words without text spans parse without textStart/textEnd", () => {
    const result = parseSpeechTimingPayload([{ word: "Hi", offset: 0, duration: 200 }]);
    assert.deepEqual(result?.words, [{ word: "Hi", startMs: 0, endMs: 200 }]);
  });
});

// ── Compact V1 parsing ────────────────────────────────────────────────────────

describe("compact V1 parsing", () => {
  test("parses to identical normalized SpeechWord values as legacy array", () => {
    const compactV1 = {
      version: 1 as const,
      words: ["Hello", "world"],
      startMs: [0, 500],
      endMs: [400, 700],
    };
    const result = parseSpeechTimingPayload(compactV1);
    assert.deepEqual(result, {
      version: 2,
      provider: "unknown",
      timeUnit: "ms",
      textUnit: "utf16",
      words: [
        { word: "Hello", startMs: 0, endMs: 400 },
        { word: "world", startMs: 500, endMs: 700 },
      ],
    });
  });

  test("compact V1 and legacy array yield the same words (modulo text spans)", () => {
    const legacy = parseSpeechTimingPayload(LEGACY_ARRAY);
    const compact = parseSpeechTimingPayload({
      version: 1,
      words: ["Hello", "world"],
      startMs: [0, 500],
      endMs: [400, 700],
    });
    // compact V1 has no text spans; legacy array does — compare just word/time fields
    assert.equal(compact?.words.length, legacy?.words.length);
    compact?.words.forEach((w, i) => {
      const lw = legacy!.words[i]!;
      assert.equal(w.word, lw.word);
      assert.equal(w.startMs, lw.startMs);
      assert.equal(w.endMs, lw.endMs);
    });
  });

  test("normalizes compact V1 to effective version 2, provider unknown, no text spans", () => {
    const result = parseSpeechTimingPayload({
      version: 1,
      words: ["test"],
      startMs: [100],
      endMs: [200],
    });
    assert.equal(result?.version, 2);
    assert.equal(result?.provider, "unknown");
    assert.equal(result?.timeUnit, "ms");
    assert.equal(result?.textUnit, "utf16");
    assert.equal(result?.words[0]?.textStart, undefined);
    assert.equal(result?.words[0]?.textEnd, undefined);
  });

  test("allows zero-duration words (endMs === startMs)", () => {
    const result = parseSpeechTimingPayload({
      version: 1,
      words: ["pause"],
      startMs: [300],
      endMs: [300],
    });
    assert.deepEqual(result?.words, [{ word: "pause", startMs: 300, endMs: 300 }]);
  });

  test("parses compact V1 with single word correctly", () => {
    const result = parseSpeechTimingPayload({
      version: 1,
      words: ["hello"],
      startMs: [0],
      endMs: [500],
    });
    assert.deepEqual(result?.words, [{ word: "hello", startMs: 0, endMs: 500 }]);
  });

  test("parses empty compact V1 arrays to empty words list", () => {
    const result = parseSpeechTimingPayload({ version: 1, words: [], startMs: [], endMs: [] });
    assert.deepEqual(result?.words, []);
  });
});

// ── Compact V1 serializer ─────────────────────────────────────────────────────

describe("createSpeechTimingPayloadV1", () => {
  test("emits exact columnar shape with no extra fields", () => {
    const words: SpeechWord[] = [
      { word: "Hello", startMs: 0, endMs: 400 },
      { word: "world", startMs: 500, endMs: 700 },
    ];
    assert.deepEqual(createSpeechTimingPayloadV1(words), {
      version: 1,
      words: ["Hello", "world"],
      startMs: [0, 500],
      endMs: [400, 700],
    });
  });

  test("drops text spans even when present on SpeechWord input", () => {
    const payload = createSpeechTimingPayloadV1(NORMALIZED_WORDS);
    assert.deepEqual(Object.keys(payload).sort(), ["endMs", "startMs", "version", "words"]);
    assert.equal(payload.version, 1);
  });

  test("roundtrips: V1 serialized then parsed yields same words/times", () => {
    const words: SpeechWord[] = [
      { word: "alpha", startMs: 0, endMs: 100 },
      { word: "beta", startMs: 150, endMs: 300 },
    ];
    const v1 = createSpeechTimingPayloadV1(words);
    const parsed = parseSpeechTimingPayload(v1);
    assert.deepEqual(parsed?.words, words);
  });

  test("empty words list produces empty arrays", () => {
    assert.deepEqual(createSpeechTimingPayloadV1([]), {
      version: 1,
      words: [],
      startMs: [],
      endMs: [],
    });
  });
});

// ── legacySpeechWordsToTimingPayloadV1 ────────────────────────────────────────

describe("legacySpeechWordsToTimingPayloadV1", () => {
  test("converts legacy array to compact V1 columnar shape (sorted by startMs)", () => {
    assert.deepEqual(legacySpeechWordsToTimingPayloadV1(LEGACY_ARRAY), {
      version: 1,
      words: ["Hello", "world"],
      startMs: [0, 500],
      endMs: [400, 700],
    });
  });

  test("returns null for non-array input", () => {
    assert.equal(legacySpeechWordsToTimingPayloadV1(null), null);
    assert.equal(legacySpeechWordsToTimingPayloadV1({}), null);
    assert.equal(legacySpeechWordsToTimingPayloadV1("bad"), null);
  });

  test("returns null for malformed legacy entries", () => {
    assert.equal(
      legacySpeechWordsToTimingPayloadV1([{ word: "Hi", offset: 0, duration: -1 }]),
      null,
    );
  });
});

// ── Compact V1 validation rejects ────────────────────────────────────────────

describe("compact V1 validation rejects", () => {
  test("rejects mismatched array lengths (words vs startMs)", () => {
    assert.equal(
      parseSpeechTimingPayload({ version: 1, words: ["a", "b"], startMs: [0], endMs: [100, 200] }),
      null,
    );
  });

  test("rejects mismatched array lengths (words vs endMs)", () => {
    assert.equal(
      parseSpeechTimingPayload({ version: 1, words: ["a"], startMs: [0, 10], endMs: [100, 200] }),
      null,
    );
  });

  test("rejects endMs < startMs", () => {
    assert.equal(
      parseSpeechTimingPayload({ version: 1, words: ["x"], startMs: [500], endMs: [400] }),
      null,
    );
  });

  test("rejects negative startMs", () => {
    assert.equal(
      parseSpeechTimingPayload({ version: 1, words: ["x"], startMs: [-1], endMs: [100] }),
      null,
    );
  });

  test("rejects negative endMs", () => {
    assert.equal(
      parseSpeechTimingPayload({ version: 1, words: ["x"], startMs: [0], endMs: [-5] }),
      null,
    );
  });

  test("rejects non-finite times (Infinity)", () => {
    assert.equal(
      parseSpeechTimingPayload({ version: 1, words: ["x"], startMs: [Infinity], endMs: [500] }),
      null,
    );
  });

  test("rejects non-finite times (NaN)", () => {
    assert.equal(
      parseSpeechTimingPayload({ version: 1, words: ["x"], startMs: [NaN], endMs: [500] }),
      null,
    );
  });

  test("rejects empty word strings", () => {
    assert.equal(
      parseSpeechTimingPayload({ version: 1, words: [""], startMs: [0], endMs: [100] }),
      null,
    );
  });

  test("rejects non-string word entries", () => {
    assert.equal(
      parseSpeechTimingPayload({ version: 1, words: [42], startMs: [0], endMs: [100] }),
      null,
    );
  });

  test("rejects non-array words field", () => {
    assert.equal(
      parseSpeechTimingPayload({ version: 1, words: "hello", startMs: [0], endMs: [100] }),
      null,
    );
  });

  test("rejects missing startMs", () => {
    assert.equal(
      parseSpeechTimingPayload({ version: 1, words: ["x"], endMs: [100] }),
      null,
    );
  });

  test("rejects missing endMs", () => {
    assert.equal(
      parseSpeechTimingPayload({ version: 1, words: ["x"], startMs: [0] }),
      null,
    );
  });

  test("rejects old V1-shaped objects with provider/timeUnit (not compact V1)", () => {
    // Has version:1 but words is array of objects (legacy format), not strings
    assert.equal(
      parseSpeechTimingPayload({
        version: 1,
        provider: "azure",
        timeUnit: "ms",
        textUnit: "utf16",
        words: [{ word: "Hello", offset: 0, duration: 500 }],
      }),
      null,
    );
  });
});

// ── V2 serializer unchanged ───────────────────────────────────────────────────

describe("V2 serializer output unchanged", () => {
  test("createSpeechTimingPayloadV2 output is deep-equal to pre-change shape", () => {
    const words: SpeechWord[] = [
      { word: "Hello", startMs: 0, endMs: 400, textStart: 0, textEnd: 5 },
      { word: "world", startMs: 500, endMs: 700, textStart: 6, textEnd: 11 },
    ];
    assert.deepEqual(createSpeechTimingPayloadV2("azure", words), {
      version: 2,
      provider: "azure",
      timeUnit: "ms",
      textUnit: "utf16",
      words: ["Hello", "world"],
      startMs: [0, 500],
      endMs: [400, 700],
      textStart: [0, 6],
      textEnd: [5, 11],
    });
  });

  test("V2 without text spans omits textStart/textEnd", () => {
    const words: SpeechWord[] = [
      { word: "Hi", startMs: 0, endMs: 300 },
    ];
    const v2 = createSpeechTimingPayloadV2("polly", words);
    assert.equal(v2.version, 2);
    assert.equal(v2.provider, "polly");
    assert.equal(v2.timeUnit, "ms");
    assert.equal(v2.textUnit, "utf16");
    assert.equal("textStart" in v2, false);
    assert.equal("textEnd" in v2, false);
  });

  test("legacySpeechWordsToTimingPayloadV2 output matches V2 serializer", () => {
    assert.deepEqual(
      legacySpeechWordsToTimingPayloadV2(LEGACY_ARRAY, "azure"),
      {
        version: 2,
        provider: "azure",
        timeUnit: "ms",
        textUnit: "utf16",
        words: ["Hello", "world"],
        startMs: [0, 500],
        endMs: [400, 700],
        textStart: [0, 6],
        textEnd: [5, 11],
      },
    );
  });

  test("V2 parsed payload is unchanged after adding V1 parser", () => {
    const v2payload = {
      version: 2 as const,
      provider: "azure",
      timeUnit: "ms" as const,
      textUnit: "utf16" as const,
      words: ["Hello", "world"],
      startMs: [0, 500],
      endMs: [400, 700],
      textStart: [0, 6],
      textEnd: [5, 11],
    };
    assert.deepEqual(parseSpeechTimingPayload(v2payload), {
      version: 2,
      provider: "azure",
      timeUnit: "ms",
      textUnit: "utf16",
      words: [
        { word: "Hello", startMs: 0, endMs: 400, textStart: 0, textEnd: 5 },
        { word: "world", startMs: 500, endMs: 700, textStart: 6, textEnd: 11 },
      ],
    });
  });
});
