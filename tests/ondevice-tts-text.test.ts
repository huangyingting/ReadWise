/**
 * On-device narration text handling: Kokoro/Misaki text normalization,
 * offset-preserving sentence chunking, and word alignment from Paradee
 * duration frames (including every fallback path).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeText } from "@/lib/ondevice-tts/text-normalize";
import {
  buildChunkAlignment,
  buildDurationWordAlignmentData,
  buildWordAlignmentData,
  segmentTextIntoWords,
  splitTextWithOffsets,
} from "@/lib/ondevice-tts/word-timestamps";

const SAMPLE_RATE = 24_000;
const FRAME = 600; // samples per duration unit (25 ms)

function tokens(phonemes: string): string[] {
  return ["$", ...Array.from(phonemes), "$"];
}

function units(count: number, value = 1): number[] {
  return Array.from({ length: count }, () => value);
}

function align(text: string, toks: string[], durations: number[], samples = toks.length * FRAME, rate = SAMPLE_RATE) {
  return buildDurationWordAlignmentData(text, toks, durations, samples, rate).map((w) => [w.text, w.startMs, w.endMs]);
}

describe("normalizeText", () => {
  test("spells years, clock times, money, decimals, and ranges as spoken", () => {
    assert.equal(
      normalizeText("In 1996, 2000s and 1905 and 1100 and 1008s"),
      "In 19 96, 2000s and 19 oh 5 and 11 hundred and 1008s",
    );
    assert.equal(
      normalizeText("At 3:00 and 3:05 and 3:45 and 13:30"),
      "At 3 o'clock and 3 oh 5 and 3 45 and 13:30",
    );
    assert.equal(
      normalizeText("It cost $1, $5, £2.5, $1.01, £1.01, $3.50 and $2 million"),
      "It cost 1 dollar, 5 dollars, 2 pounds and 50 pence, 1 dollar and 1 cent, 1 pound and 1 penny, 3 dollars and 50 cents and 2 million dollars",
    );
    assert.equal(normalizeText("Pi is 3.14 and .5"), "Pi is 3 point 1 4 and  point 5");
    assert.equal(normalizeText("Pages 10-20 and 5S and NASA's"), "Pages 10 to 20 and 5 S and NASA's");
  });

  test("expands titles, initialisms, and full-width punctuation", () => {
    assert.equal(
      normalizeText("Dr. Smith met Mr. Jones, Ms. Lee and Mrs. Brown etc. yeah"),
      "Doctor Smith met Mister Jones, Miss Lee and Mrs Brown etc. ye'a",
    );
    assert.equal(normalizeText("U.S.A. went to the U.S. now"), "U-S-A- went to the U-S- now");
    assert.equal(
      normalizeText("“Quoted” (aside) ‘single’ «guillemets»"),
      "\"Quoted\" «aside» 'single' \"guillemets\"",
    );
    assert.equal(normalizeText("a、b。c！d，e：f；g？h"), "a, b. c! d, e: f; g? h");
    assert.equal(normalizeText("line one\n \nline two\ttab"), "line one\n\nline two tab");
  });
});

describe("segmentTextIntoWords and splitTextWithOffsets", () => {
  test("segments words and whitespace with UTF-16 offsets", () => {
    assert.deepEqual(segmentTextIntoWords(""), { segments: [], wordCount: 0 });
    const { segments, wordCount } = segmentTextIntoWords("  hi  there ");
    assert.equal(wordCount, 2);
    assert.deepEqual(
      segments.map((s) => [s.type, s.text, s.charStart, s.charEnd]),
      [
        ["whitespace", "  ", 0, 2],
        ["word", "hi", 2, 4],
        ["whitespace", "  ", 4, 6],
        ["word", "there", 6, 11],
        ["whitespace", " ", 11, 12],
      ],
    );
  });

  test("splits sentences around abbreviations, list numbers, decimals, and ellipses", () => {
    const text = `Dr. Smith arrived. He said: "Wait!" 1. First item. Prices were $9.99 today... Then e.g. it rained. U.S. Army came. ... Final words here`;
    const spans = splitTextWithOffsets(text, 280);
    assert.deepEqual(
      spans.map((s) => s.text),
      [
        "Dr. Smith arrived.",
        'He said: "Wait!"',
        "1. First item.",
        "Prices were $9.99 today...",
        "Then e.g. it rained.",
        "U.S. Army came.",
        "... Final words here",
      ],
    );
    for (const span of spans) assert.equal(text.slice(span.charStart, span.charEnd), span.text);
    assert.deepEqual(
      splitTextWithOffsets("Line one\nLine two\n\nLine three").map((s) => s.text),
      ["Line one", "Line two", "Line three"],
    );
  });

  test("splits long sentences at clause punctuation, then whitespace, never inside a word", () => {
    const long =
      "alpha beta gamma delta, epsilon zeta eta theta iota; kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega and so on forever";
    const spans = splitTextWithOffsets(long, 30);
    assert.deepEqual(
      spans.map((s) => [s.text, s.charStart, s.charEnd]),
      [
        ["alpha beta gamma delta,", 0, 23],
        ["epsilon zeta eta theta iota;", 24, 52],
        ["kappa lambda mu nu xi omicron", 53, 82],
        ["pi rho sigma tau upsilon phi", 83, 111],
        ["chi psi omega and so on", 112, 135],
        ["forever", 136, 143],
      ],
    );
    assert.deepEqual(
      splitTextWithOffsets(`short ${"x".repeat(50)} tail`, 20).map((s) => s.text),
      ["short", "x".repeat(50), "tail"],
    );
  });
});

describe("word alignment", () => {
  test("character-proportional alignment keeps offsets and indices", () => {
    assert.deepEqual(
      buildWordAlignmentData("Hi  there you", 1.3, 0.5, { chunkCharStart: 10, chunkIndex: 2, startingWordIndex: 4 }),
      [
        { text: "Hi", startMs: 500, endMs: 700, charStart: 10, charEnd: 12, chunkIndex: 2, wordIndex: 4 },
        { text: "there", startMs: 900, endMs: 1400, charStart: 14, charEnd: 19, chunkIndex: 2, wordIndex: 5 },
        { text: "you", startMs: 1500, endMs: 1800, charStart: 20, charEnd: 23, chunkIndex: 2, wordIndex: 6 },
      ],
    );
  });

  test("aligns words to duration frames, timing standalone punctuation from its token", () => {
    const toks = tokens("hˈI — ðˈɛɹ.");
    assert.deepEqual(align("Hi — there.", toks, units(toks.length)), [
      ["Hi", 25, 100],
      ["—", 125, 150],
      ["there.", 175, 275],
    ]);
    const unvoiced = tokens("hˈI ðˈɛɹ");
    assert.deepEqual(align("Hi — there", unvoiced, units(unvoiced.length)), [
      ["Hi", 25, 100],
      ["—", 113, 113],
      ["there", 125, 225],
    ]);
  });

  test("maps numbers, ordinals, and spelling special cases onto phonemes", () => {
    const toks = tokens("ðə twˈɛnti fˈɜɹst wˈʌn, nˈIn hˈʌndɹəd ænd wˈʌns, hˈu nˈOz kwˈɪk bˈɑks ʤˈʌʤ");
    assert.deepEqual(
      align("The 21st one, 900 and once, who knows quick box judge", toks, units(toks.length)),
      [
        ["The", 25, 75],
        ["21st", 100, 450],
        ["one,", 475, 575],
        ["900", 625, 950],
        ["and", 975, 1050],
        ["once,", 1075, 1200],
        ["who", 1250, 1325],
        ["knows", 1350, 1450],
        ["quick", 1475, 1600],
        ["box", 1625, 1750],
        ["judge", 1775, 1875],
      ],
    );
    const big = tokens("θɹˈi bˈɪljən fˈɔɹ ˈAt");
    const words = buildDurationWordAlignmentData(
      "3000000000 4 8th 1234567890123 1st 2nd 3rd 5th U.S.",
      big,
      units(big.length),
      big.length * FRAME,
      SAMPLE_RATE,
    );
    assert.equal(words.length, 9);
    for (let i = 1; i < words.length; i++) assert.ok(words[i]!.startMs >= words[i - 1]!.endMs);
  });

  test("falls back to proportional timing when durations are unusable", () => {
    assert.deepEqual(align("Hi there", tokens("hI"), [1, 1], 2400), [
      ["Hi", 0, 25],
      ["there", 38, 100],
    ]);
    const toks = tokens("hI ðɛɹ");
    assert.deepEqual(align("Hi there", toks, units(toks.length, 0), 9600), [
      ["Hi", 0, 100],
      ["there", 150, 400],
    ]);
    assert.deepEqual(align("Hi there", ["$", ",", ".", "$"], units(4), 4800), [
      ["Hi", 0, 50],
      ["there", 75, 200],
    ]);
    assert.deepEqual(align("Hi", tokens("hI"), units(4), 2400, 0), [["Hi", 0, 0]]);
  });

  test("uses raw durations when every frame rounds to zero, with the chunk offset", () => {
    const toks = tokens("hI ðɛɹ");
    const words = buildDurationWordAlignmentData("Hi there", toks, units(toks.length, 0.3), 9600, SAMPLE_RATE, 1);
    assert.deepEqual(words.map((w) => [w.text, w.startMs, w.endMs]), [
      ["Hi", 1050, 1150],
      ["there", 1200, 1350],
    ]);
  });

  test("returns no words for empty or whitespace-only chunks", () => {
    assert.deepEqual(buildDurationWordAlignmentData("", tokens("hI"), units(4), 2400, SAMPLE_RATE), []);
    assert.deepEqual(buildDurationWordAlignmentData("   ", tokens("hI"), units(4), 2400, SAMPLE_RATE), []);
  });

  test("buildChunkAlignment places chunks on the narration timeline", () => {
    assert.deepEqual(
      buildChunkAlignment({
        chunkIndex: 1,
        span: { text: "Hello you", charStart: 5, charEnd: 14 },
        chunkSamples: 24_000,
        totalSamplesBeforeChunk: 48_000,
        sampleRate: SAMPLE_RATE,
        startingWordIndex: 3,
      }),
      {
        chunkIndex: 1,
        text: "Hello you",
        charStart: 5,
        charEnd: 14,
        startMs: 2000,
        endMs: 3000,
        durationMs: 1000,
        words: [
          { text: "Hello", startMs: 2000, endMs: 2556, charStart: 5, charEnd: 10, chunkIndex: 1, wordIndex: 3 },
          { text: "you", startMs: 2667, endMs: 3000, charStart: 11, charEnd: 14, chunkIndex: 1, wordIndex: 4 },
        ],
      },
    );
    const silent = buildChunkAlignment({
      chunkIndex: 0,
      span: { text: "Hi", charStart: 0, charEnd: 2 },
      chunkSamples: 0,
      totalSamplesBeforeChunk: 0,
      sampleRate: 0,
      startingWordIndex: 0,
    });
    assert.equal(silent.durationMs, 0);
    assert.deepEqual(silent.words.map((w) => [w.startMs, w.endMs]), [[0, 0]]);
  });
});
