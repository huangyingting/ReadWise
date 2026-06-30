import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeWord, gradeDictation, segmentDictation } from "@/lib/dictation";

// ─── normalizeWord ────────────────────────────────────────────────────────────

describe("normalizeWord", () => {
  test("lowercases input", () => {
    assert.equal(normalizeWord("Hello"), "hello");
    assert.equal(normalizeWord("WORLD"), "world");
  });

  test("strips leading and trailing punctuation", () => {
    assert.equal(normalizeWord("hello,"), "hello");
    assert.equal(normalizeWord('"hello"'), "hello");
    assert.equal(normalizeWord("don't"), "don't"); // apostrophe inside kept
    assert.equal(normalizeWord("(test)"), "test");
    assert.equal(normalizeWord("...wait"), "wait");
  });

  test("returns empty string for pure punctuation", () => {
    assert.equal(normalizeWord("!!!"), "");
    assert.equal(normalizeWord("---"), "");
    assert.equal(normalizeWord("."), "");
  });
});

// ─── gradeDictation ───────────────────────────────────────────────────────────

describe("gradeDictation", () => {
  test("exact match → 100% accuracy, all correct", () => {
    const { tokens, accuracy } = gradeDictation("Hello world", "Hello world");
    assert.equal(accuracy, 100);
    assert.ok(tokens.every((t) => t.status === "correct"));
  });

  test("case insensitive — uppercase typed matches lowercase ref", () => {
    const { tokens, accuracy } = gradeDictation("hello world", "HELLO WORLD");
    assert.equal(accuracy, 100);
    assert.ok(tokens.every((t) => t.status === "correct"));
  });

  test("punctuation tolerant — trailing comma ignored", () => {
    const { tokens, accuracy } = gradeDictation(
      "The cat sat.",
      "The cat sat",
    );
    assert.equal(accuracy, 100);
    assert.ok(tokens.every((t) => t.status === "correct"));
  });

  test("missing word → reduces accuracy, produces missing token", () => {
    const { tokens, accuracy } = gradeDictation("The big cat sat", "The cat sat");
    assert.ok(accuracy < 100);
    const statuses = tokens.map((t) => t.status);
    assert.ok(statuses.includes("missing"), `Expected missing in ${JSON.stringify(statuses)}`);
  });

  test("extra word → produces extra token", () => {
    const { tokens } = gradeDictation("The cat sat", "The big cat sat");
    const statuses = tokens.map((t) => t.status);
    assert.ok(statuses.includes("extra"), `Expected extra in ${JSON.stringify(statuses)}`);
  });

  test("wrong word → produces wrong token with typed field", () => {
    const { tokens } = gradeDictation("The cat sat", "The dog sat");
    const wrongToken = tokens.find((t) => t.status === "wrong");
    assert.ok(wrongToken, "Expected a wrong token");
    assert.equal(wrongToken?.typed, "dog");
    assert.equal(wrongToken?.word, "cat");
  });

  test("empty typed input → all missing, 0% accuracy", () => {
    const { tokens, accuracy } = gradeDictation("The cat sat", "");
    assert.equal(accuracy, 0);
    assert.ok(tokens.every((t) => t.status === "missing"));
  });

  test("empty reference → extra tokens, 100% accuracy (edge case)", () => {
    const { tokens, accuracy } = gradeDictation("", "some words");
    assert.equal(accuracy, 100); // 0 ref words → 100% by convention
    assert.ok(tokens.every((t) => t.status === "extra"));
  });

  test("both empty → 100% accuracy, no tokens", () => {
    const { tokens, accuracy } = gradeDictation("", "");
    assert.equal(accuracy, 100);
    assert.deepEqual(tokens, []);
  });

  test("accuracy is rounded integer percentage", () => {
    // 2 out of 3 correct → 66.67 → 67
    const { accuracy } = gradeDictation("one two three", "one two four");
    assert.equal(accuracy, 67);
  });

  test("token order follows reference word order", () => {
    const { tokens } = gradeDictation("one two three", "one two three");
    assert.deepEqual(
      tokens.map((t) => t.word),
      ["one", "two", "three"],
    );
  });

  test("mixed correct / wrong / missing / extra", () => {
    // ref:   "The quick brown fox"
    // typed: "The fast fox jumps"
    const { tokens } = gradeDictation("The quick brown fox", "The fast fox jumps");
    const statuses = tokens.map((t) => t.status);
    assert.ok(statuses.includes("correct"), "should have correct");
    // Either wrong or missing+extra are acceptable depending on alignment
    assert.ok(
      statuses.includes("wrong") || statuses.includes("missing"),
      `Should have wrong or missing. Got: ${JSON.stringify(statuses)}`,
    );
  });
});

// ─── segmentDictation ─────────────────────────────────────────────────────────

describe("segmentDictation", () => {
  const makeWord = (
    word: string,
    offset: number,
    duration: number,
  ) => ({ word, startMs: offset, endMs: offset + duration });

  test("returns empty array for empty text", () => {
    assert.deepEqual(segmentDictation("", []), []);
  });

  test("returns empty array when no word timings provided", () => {
    assert.deepEqual(segmentDictation("Hello world.", []), []);
  });

  test("segments a simple two-sentence text", () => {
    const text = "The cat sat on the mat. The dog barked loudly.";
    //             0123456789012345678901234 5678901234567890123456
    //                                                            ^45
    // "The cat sat on the mat." = 0..22  (23 chars)
    // "The dog barked loudly." = 24..45 (22 chars)
    const w1 = makeWord("The", 0, 300);
    const w2 = makeWord("cat", 400, 300);
    const w3 = makeWord("sat", 800, 300);
    const w4 = makeWord("on", 1200, 200);
    const w5 = makeWord("the", 1500, 300);
    const w6 = makeWord("mat", 1900, 300);
    const w7 = makeWord("The", 2500, 300);
    const w8 = makeWord("dog", 2900, 300);
    const w9 = makeWord("barked", 3300, 500);
    const w10 = makeWord("loudly", 3900, 400);

    const segs = segmentDictation(text, [w1, w2, w3, w4, w5, w6, w7, w8, w9, w10]);
    assert.ok(segs.length >= 1, `Expected at least 1 segment, got ${segs.length}`);
    // First segment should start at 0.0
    assert.equal(segs[0].startTime, 0.0);
    assert.ok(segs[0].text.length > 0);
  });

  test("drops sentences with fewer than 3 words", () => {
    // A very short sentence (< 3 words) that also triggers the abbreviation guard
    // (e.g. "Go") means the cursor doesn't advance and the whole paragraph
    // is kept together rather than emitting a standalone 1-word segment.
    // Either way, no 1- or 2-word segment should appear.
    const text = "The cat ran fast. The dog barked loudly today.";
    const words = [
      makeWord("The", 0, 300),
      makeWord("cat", 400, 300),
      makeWord("ran", 800, 300),
      makeWord("fast", 1200, 300),
      makeWord("The", 1800, 200),
      makeWord("dog", 2100, 300),
      makeWord("barked", 2500, 400),
      makeWord("loudly", 3000, 400),
      makeWord("today", 3500, 300),
    ];
    const segs = segmentDictation(text, words);
    // No segment should be fewer than 3 words
    for (const seg of segs) {
      const wordCount = seg.text.split(/\s+/).filter(Boolean).length;
      assert.ok(
        wordCount >= 3,
        `Segment "${seg.text.slice(0, 40)}" has only ${wordCount} words`,
      );
    }
  });
});
