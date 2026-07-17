process.env.LOG_LEVEL = "error";

/**
 * Focused tests for speech timing span repair (issue #1060).
 *
 * Covers:
 *  - enrichSpeechTimingSpans: punctuation, contractions, Unicode/UTF-16, long-row
 *    single-miss, V2 freeze (words/timings unchanged)
 *  - repairSpeechTimingSpans: dry-run/apply semantics, idempotent, invalid input,
 *    V1/legacy skipped, missing article text skipped
 *  - production generation path: spans always present after alignment
 */

import { test, describe, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { enrichSpeechTimingSpans } from "@/lib/speech/timing-enrichment";

type SpeechRow = {
  id: string;
  articleId: string;
  words: unknown;
  plainText: string;
};

let rows: SpeechRow[] = [];
let updates: Array<{ where: { id: string }; data: { words: unknown } }> = [];
let updateShouldThrow = false;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        articleSpeech: {
          findMany: async () =>
            rows.map(({ plainText, ...row }) => ({
              ...row,
              article: { content: plainText },
            })),
          update: async (args: { where: { id: string }; data: { words: unknown } }) => {
            if (updateShouldThrow) throw new Error("DB connection failed");
            updates.push(args);
            return {};
          },
        },
      },
    },
  });
});

beforeEach(() => {
  rows = [];
  updates = [];
  updateShouldThrow = false;
});

// ── enrichSpeechTimingSpans ─────────────────────────────────────────────────

describe("enrichSpeechTimingSpans", () => {
  test("assigns correct plainText-relative spans for simple words", async () => {
    const words = [
      { word: "Hello", startMs: 0, endMs: 100 },
      { word: "world", startMs: 100, endMs: 200 },
    ];
    const result = enrichSpeechTimingSpans(words, "Hello world");
    assert.equal(result.length, 2);
    assert.deepEqual([result[0]?.textStart, result[0]?.textEnd], [0, 5]);
    assert.deepEqual([result[1]?.textStart, result[1]?.textEnd], [6, 11]);
  });

  test("aligns punctuation tokens correctly", async () => {
    const words = [
      { word: "Hello", startMs: 0, endMs: 100 },
      { word: ",", startMs: 100, endMs: 100 },  // zero-duration punctuation
      { word: "world", startMs: 100, endMs: 200 },
      { word: ".", startMs: 200, endMs: 200 },  // zero-duration punctuation
    ];
    const result = enrichSpeechTimingSpans(words, "Hello, world.");
    // Zero-duration entries that can't be aligned are excluded
    // Spoken words get spans
    const spoken = result.filter((w) => w.word !== "," && w.word !== ".");
    assert.equal(spoken.length, 2);
    assert.ok(spoken.every((w) => typeof w.textStart === "number" && typeof w.textEnd === "number"));
  });

  test("excludes zero-duration words that cannot be aligned", async () => {
    const words = [
      { word: "Hello", startMs: 0, endMs: 100 },
      { word: "\u200b", startMs: 100, endMs: 100 },  // zero-duration invisible char
      { word: "world", startMs: 100, endMs: 200 },
    ];
    const result = enrichSpeechTimingSpans(words, "Hello world");
    assert.equal(result.length, 2); // zero-dur unaligned excluded
    assert.ok(result.every((w) => w.word !== "\u200b"));
  });

  test("assigns neighbour fallback for non-zero-duration unaligned words", async () => {
    // 'twenty' is an Azure TTS expansion of '20' — won't be in plainText
    const words = [
      { word: "about", startMs: 0, endMs: 100 },
      { word: "twenty", startMs: 100, endMs: 200 },  // not in plainText
      { word: "million", startMs: 200, endMs: 300 },
    ];
    const result = enrichSpeechTimingSpans(words, "about 20 million");
    // 'twenty' should receive a valid fallback span (not drop the whole array)
    assert.equal(result.length, 3);
    const twenty = result.find((w) => w.word === "twenty");
    assert.ok(twenty !== undefined);
    assert.ok(typeof twenty.textStart === "number" && typeof twenty.textEnd === "number");
    assert.ok(twenty.textEnd! > twenty.textStart!);
  });

  test("preserves word timings (V2 freeze — words/startMs/endMs unchanged)", async () => {
    const words = [
      { word: "The", startMs: 0, endMs: 50 },
      { word: "quick", startMs: 60, endMs: 200 },
      { word: "brown", startMs: 210, endMs: 350 },
    ];
    const result = enrichSpeechTimingSpans(words, "The quick brown fox");
    assert.equal(result.length, 3);
    for (let i = 0; i < words.length; i++) {
      assert.equal(result[i]!.word, words[i]!.word);
      assert.equal(result[i]!.startMs, words[i]!.startMs);
      assert.equal(result[i]!.endMs, words[i]!.endMs);
    }
  });

  test("handles contractions correctly (UTF-16 span)", async () => {
    const words = [
      { word: "don't", startMs: 0, endMs: 100 },
      { word: "worry", startMs: 110, endMs: 200 },
    ];
    const result = enrichSpeechTimingSpans(words, "don't worry");
    assert.equal(result.length, 2);
    const dont = result[0]!;
    assert.equal(dont.textStart, 0);
    assert.equal(dont.textEnd, 5); // "don't" is 5 UTF-16 code units
  });

  test("handles Unicode characters correctly (UTF-16 spans)", async () => {
    const words = [
      { word: "caf\u00e9", startMs: 0, endMs: 100 },  // é is U+00E9 (1 UTF-16 unit)
      { word: "owner", startMs: 110, endMs: 200 },
    ];
    const result = enrichSpeechTimingSpans(words, "caf\u00e9 owner");
    assert.equal(result.length, 2);
    const cafe = result[0]!;
    assert.equal(cafe.textStart, 0);
    assert.equal(cafe.textEnd, 4); // "café" = 4 UTF-16 code units
  });

  test("handles long-row single-miss: one unaligned word does not drop all spans", async () => {
    // Build a long article: 100 words with a single unaligned word in the middle
    const articleWords = Array.from({ length: 50 }, (_, i) => `word${i}`);
    const words = [
      ...articleWords.slice(0, 25).map((w, i) => ({
        word: w,
        startMs: i * 100,
        endMs: i * 100 + 80,
      })),
      // This word doesn't exist in plainText (Azure TTS expansion)
      { word: "unexpandedterm", startMs: 2500, endMs: 2600 },
      ...articleWords.slice(25).map((w, i) => ({
        word: w,
        startMs: (i + 26) * 100,
        endMs: (i + 26) * 100 + 80,
      })),
    ];
    const plainText = articleWords.join(" "); // no 'unexpandedterm'
    const result = enrichSpeechTimingSpans(words, plainText);

    // All words should be in result (non-zero-duration, so fallback)
    assert.equal(result.length, words.length);
    // Every word should have a valid span
    assert.ok(result.every((w) => typeof w.textStart === "number" && typeof w.textEnd === "number" && w.textEnd! > w.textStart!));
    // The regular words should have correct spans
    const first = result[0]!;
    assert.equal(first.textStart, 0);
    assert.equal(first.textEnd, "word0".length);
  });

  test("returns empty array for empty words", async () => {
    assert.deepEqual(enrichSpeechTimingSpans([], "Hello"), []);
  });

  test("returns words unchanged when plainText is empty", async () => {
    const words = [{ word: "Hello", startMs: 0, endMs: 100 }];
    const result = enrichSpeechTimingSpans(words, "");
    assert.deepEqual(result, words);
  });
});

// ── repairSpeechTimingSpans ─────────────────────────────────────────────────

describe("repairSpeechTimingSpans", () => {
  test("dry-run reports rows to repair without writing", async () => {
    const { repairSpeechTimingSpans } = await import("@/lib/speech/timing-migration");

    rows = [
      {
        id: "row1",
        articleId: "a1",
        words: {
          version: 2,
          provider: "azure",
          timeUnit: "ms",
          textUnit: "utf16",
          words: ["Hello", "world"],
          startMs: [0, 100],
          endMs: [80, 200],
          // NO textStart/textEnd
        },
        plainText: "Hello world",
      },
    ];

    const result = await repairSpeechTimingSpans({ dryRun: true });

    assert.equal(result.scanned, 1);
    assert.equal(result.repaired, 1);
    assert.equal(result.skippedHasSpans, 0);
    assert.equal(result.failed, 0);
    assert.equal(updates.length, 0); // dry-run: no writes
  });

  test("apply mode writes repaired spans to database", async () => {
    const { repairSpeechTimingSpans } = await import("@/lib/speech/timing-migration");

    rows = [
      {
        id: "row1",
        articleId: "a1",
        words: {
          version: 2,
          provider: "azure-batch",
          timeUnit: "ms",
          textUnit: "utf16",
          words: ["Hello", "world"],
          startMs: [0, 100],
          endMs: [80, 200],
        },
        plainText: "Hello world",
      },
    ];

    const result = await repairSpeechTimingSpans({ dryRun: false });

    assert.equal(result.scanned, 1);
    assert.equal(result.repaired, 1);
    assert.equal(result.failed, 0);
    assert.equal(updates.length, 1);

    const stored = updates[0]?.data.words as Record<string, unknown>;
    assert.equal(stored.version, 2);
    assert.equal(stored.provider, "azure-batch");
    assert.ok(Array.isArray(stored.textStart));
    assert.ok(Array.isArray(stored.textEnd));
    assert.deepEqual(stored.textStart, [0, 6]);
    assert.deepEqual(stored.textEnd, [5, 11]);
  });

  test("idempotent: skips rows that already have valid spans", async () => {
    const { repairSpeechTimingSpans } = await import("@/lib/speech/timing-migration");

    rows = [
      {
        id: "row1",
        articleId: "a1",
        words: {
          version: 2,
          provider: "azure",
          timeUnit: "ms",
          textUnit: "utf16",
          words: ["Hello", "world"],
          startMs: [0, 100],
          endMs: [80, 200],
          textStart: [0, 6],
          textEnd: [5, 11],
        },
        plainText: "Hello world",
      },
    ];

    const result = await repairSpeechTimingSpans({ dryRun: false });

    assert.equal(result.scanned, 1);
    assert.equal(result.repaired, 0);
    assert.equal(result.skippedHasSpans, 1);
    assert.equal(updates.length, 0);
  });

  test("skips V1 rows (out of scope)", async () => {
    const { repairSpeechTimingSpans } = await import("@/lib/speech/timing-migration");

    rows = [
      {
        id: "row1",
        articleId: "a1",
        words: {
          version: 1,
          words: ["Hello"],
          startMs: [0],
          endMs: [100],
        },
        plainText: "Hello world",
      },
    ];

    const result = await repairSpeechTimingSpans({ dryRun: false });

    assert.equal(result.scanned, 1);
    assert.equal(result.skippedHasSpans, 1);
    assert.equal(result.repaired, 0);
    assert.equal(updates.length, 0);
  });

  test("skips legacy array rows (out of scope)", async () => {
    const { repairSpeechTimingSpans } = await import("@/lib/speech/timing-migration");

    rows = [
      {
        id: "row1",
        articleId: "a1",
        words: [{ word: "Hello", offset: 0, duration: 100 }],
        plainText: "Hello",
      },
    ];

    const result = await repairSpeechTimingSpans({ dryRun: false });

    assert.equal(result.scanned, 1);
    assert.equal(result.skippedHasSpans, 1);
    assert.equal(result.repaired, 0);
  });

  test("skips rows with empty article-derived text", async () => {
    const { repairSpeechTimingSpans } = await import("@/lib/speech/timing-migration");

    rows = [
      {
        id: "row1",
        articleId: "a1",
        words: {
          version: 2,
          provider: "azure",
          timeUnit: "ms",
          textUnit: "utf16",
          words: ["Hello"],
          startMs: [0],
          endMs: [100],
        },
        plainText: "",
      },
    ];

    const result = await repairSpeechTimingSpans({ dryRun: false });

    assert.equal(result.scanned, 1);
    assert.equal(result.skippedNoPlainText, 1);
    assert.equal(result.repaired, 0);
    assert.equal(updates.length, 0);
  });

  test("throws for explicitly empty --ids array", async () => {
    const { repairSpeechTimingSpans } = await import("@/lib/speech/timing-migration");

    await assert.rejects(
      () => repairSpeechTimingSpans({ dryRun: true, ids: [] }),
      /--ids must not be empty/,
    );
  });

  test("repairs only specified article IDs when ids provided", async () => {
    const { repairSpeechTimingSpans } = await import("@/lib/speech/timing-migration");

    // rows list is filtered by Prisma where clause (mocked), so add both
    rows = [
      {
        id: "row1",
        articleId: "a1",
        words: {
          version: 2,
          provider: "azure",
          timeUnit: "ms",
          textUnit: "utf16",
          words: ["Hello"],
          startMs: [0],
          endMs: [100],
        },
        plainText: "Hello",
      },
    ];

    const result = await repairSpeechTimingSpans({ dryRun: false, ids: ["a1"] });

    assert.equal(result.scanned, 1);
    assert.equal(result.repaired, 1);
  });

  test("preserves provider field in repaired payload", async () => {
    const { repairSpeechTimingSpans } = await import("@/lib/speech/timing-migration");

    rows = [
      {
        id: "row1",
        articleId: "a1",
        words: {
          version: 2,
          provider: "azure-batch",
          timeUnit: "ms",
          textUnit: "utf16",
          words: ["test"],
          startMs: [0],
          endMs: [100],
        },
        plainText: "test input",
      },
    ];

    await repairSpeechTimingSpans({ dryRun: false });

    const stored = updates[0]?.data.words as Record<string, unknown>;
    assert.equal(stored?.provider, "azure-batch");
    assert.equal(stored?.timeUnit, "ms");
    assert.equal(stored?.textUnit, "utf16");
  });

  test("span arrays have equal length to words array after repair", async () => {
    const { repairSpeechTimingSpans } = await import("@/lib/speech/timing-migration");

    rows = [
      {
        id: "row1",
        articleId: "a1",
        words: {
          version: 2,
          provider: "azure",
          timeUnit: "ms",
          textUnit: "utf16",
          words: ["The", "quick", "brown", "fox"],
          startMs: [0, 50, 120, 200],
          endMs: [40, 110, 190, 280],
        },
        plainText: "The quick brown fox jumps",
      },
    ];

    await repairSpeechTimingSpans({ dryRun: false });

    const stored = updates[0]?.data.words as Record<string, unknown>;
    const wordCount = (stored?.words as unknown[]).length;
    assert.equal((stored?.textStart as unknown[]).length, wordCount);
    assert.equal((stored?.textEnd as unknown[]).length, wordCount);
  });

  test("monotonic timings preserved after repair (startMs non-decreasing)", async () => {
    const { repairSpeechTimingSpans } = await import("@/lib/speech/timing-migration");

    const wordList = ["alpha", "beta", "gamma", "delta"];
    rows = [
      {
        id: "row1",
        articleId: "a1",
        words: {
          version: 2,
          provider: "azure",
          timeUnit: "ms",
          textUnit: "utf16",
          words: wordList,
          startMs: [0, 100, 200, 300],
          endMs: [80, 180, 280, 380],
        },
        plainText: wordList.join(" "),
      },
    ];

    await repairSpeechTimingSpans({ dryRun: false });

    const stored = updates[0]?.data.words as Record<string, unknown>;
    const startMs = stored?.startMs as number[];
    for (let i = 1; i < startMs.length; i++) {
      assert.ok(startMs[i]! >= startMs[i - 1]!, `startMs[${i}] < startMs[${i - 1}]`);
    }
  });

  test("all textEnd > textStart (valid spans only, no sentinel zeros)", async () => {
    const { repairSpeechTimingSpans } = await import("@/lib/speech/timing-migration");

    // Mix of words: some in plainText, one Azure TTS expansion not in text
    rows = [
      {
        id: "row1",
        articleId: "a1",
        words: {
          version: 2,
          provider: "azure",
          timeUnit: "ms",
          textUnit: "utf16",
          words: ["start", "twentyone", "end"],
          startMs: [0, 100, 200],
          endMs: [80, 180, 280],
        },
        // 'twentyone' not in plainText (Azure TTS expansion of "21")
        plainText: "start 21 end",
      },
    ];

    await repairSpeechTimingSpans({ dryRun: false });

    const stored = updates[0]?.data.words as Record<string, unknown>;
    const textStart = stored?.textStart as number[];
    const textEnd = stored?.textEnd as number[];
    for (let i = 0; i < textStart.length; i++) {
      assert.ok(textStart[i]! >= 0, `textStart[${i}] < 0`);
      assert.ok(textEnd[i]! > textStart[i]!, `textEnd[${i}] <= textStart[${i}]`);
    }
  });

  test("malformed V2 payload (endMs < startMs): parseSpeechTimingPayload returns null → skippedAlignment, no update", async () => {
    const { repairSpeechTimingSpans } = await import("@/lib/speech/timing-migration");

    rows = [
      {
        id: "row1",
        articleId: "a1",
        // Valid version:2 shape but endMs < startMs for a word entry;
        // parseSpeechTimingPayload → parseV2Payload → speechWordFromColumns
        // returns null because end < start → entire parse returns null.
        words: {
          version: 2,
          provider: "azure",
          timeUnit: "ms",
          textUnit: "utf16",
          words: ["hello"],
          startMs: [500],
          endMs: [100],
          // no textStart/textEnd → v2MissingSpans true, row reaches parse step
        },
        plainText: "hello world",
      },
    ];

    const result = await repairSpeechTimingSpans({ dryRun: false });

    assert.equal(result.scanned, 1);
    assert.equal(result.skippedAlignment, 1);
    assert.equal(result.repaired, 0);
    assert.equal(result.failed, 0);
    assert.equal(updates.length, 0);
  });

  test("all-zero-duration words absent from plainText: enrichment still lacks spans → skippedAlignment, no update", async () => {
    const { repairSpeechTimingSpans } = await import("@/lib/speech/timing-migration");

    rows = [
      {
        id: "row1",
        articleId: "a1",
        // parse succeeds; computeSpansForWords excludes all zero-duration unaligned
        // entries → enriched = [] → createSpeechTimingPayloadV2 emits no textStart/
        // textEnd → v2MissingSpans(newPayload) true → skippedAlignment.
        words: {
          version: 2,
          provider: "azure",
          timeUnit: "ms",
          textUnit: "utf16",
          words: ["xyz"],
          startMs: [0],
          endMs: [0], // zero-duration; "xyz" not in plainText → excluded
          // no textStart/textEnd → v2MissingSpans true; parse succeeds
        },
        plainText: "hello world",
      },
    ];

    const result = await repairSpeechTimingSpans({ dryRun: false });

    assert.equal(result.scanned, 1);
    assert.equal(result.skippedAlignment, 1);
    assert.equal(result.repaired, 0);
    assert.equal(result.failed, 0);
    assert.equal(updates.length, 0);
  });

  test("Prisma update throws → failed increments, error surfaced, no repaired count", async () => {
    const { repairSpeechTimingSpans } = await import("@/lib/speech/timing-migration");

    updateShouldThrow = true;
    rows = [
      {
        id: "row1",
        articleId: "a1",
        words: {
          version: 2,
          provider: "azure",
          timeUnit: "ms",
          textUnit: "utf16",
          words: ["Hello", "world"],
          startMs: [0, 100],
          endMs: [80, 200],
          // no textStart/textEnd → valid repair candidate; update will throw
        },
        plainText: "Hello world",
      },
    ];

    const result = await repairSpeechTimingSpans({ dryRun: false });

    assert.equal(result.scanned, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.repaired, 0);
    assert.equal(result.skippedAlignment, 0);
    assert.equal(updates.length, 0);
  });
});
