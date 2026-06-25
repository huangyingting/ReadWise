import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractJsonArray,
  toTitleCase,
  validateVocabulary,
  validateQuiz,
  validateTags,
} from "@/lib/ai/output/validators";

/** Minimal slug rule used to exercise tag dedup (mirrors slugifyTag shape). */
function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

test("extractJsonArray tolerates code fences and surrounding prose", () => {
  assert.deepEqual(extractJsonArray('```json\n["a","b"]\n```'), ["a", "b"]);
  assert.deepEqual(extractJsonArray('Here you go: ["x"] hope it helps'), ["x"]);
  assert.equal(extractJsonArray("not json at all"), null);
  assert.equal(extractJsonArray("[broken"), null);
  assert.equal(extractJsonArray('{"not":"array"}'), null);
});

test("toTitleCase title-cases words but preserves short acronyms", () => {
  assert.equal(toTitleCase("climate change"), "Climate Change");
  assert.equal(toTitleCase("AI"), "AI");
  assert.equal(toTitleCase("US politics"), "US Politics");
  assert.equal(toTitleCase("war and peace"), "War and Peace");
  assert.equal(toTitleCase("TECHNOLOGY"), "Technology");
});

// ---- vocabulary -----------------------------------------------------------

test("validateVocabulary keeps valid items and drops malformed ones", () => {
  const raw = JSON.stringify([
    { word: "ubiquitous", explanation: "found everywhere", example: "It is ubiquitous." },
    { word: "ephemeral", explanation: "short-lived" }, // example optional
  ]);
  const { items, rejected } = validateVocabulary(raw);
  assert.equal(items.length, 2);
  assert.equal(rejected, 0);
  assert.equal(items[1].example, "");
});

test("validateVocabulary rejects items missing word or explanation", () => {
  const raw = JSON.stringify([
    { word: "", explanation: "x" },
    { word: "valid", explanation: "" },
    { explanation: "no word" },
    "not an object",
    { word: "good", explanation: "ok" },
  ]);
  const { items, rejected } = validateVocabulary(raw);
  assert.deepEqual(
    items.map((i) => i.word),
    ["good"],
  );
  assert.equal(rejected, 4);
});

test("validateVocabulary dedups by case-insensitive word", () => {
  const raw = JSON.stringify([
    { word: "Echo", explanation: "a" },
    { word: "echo", explanation: "b" },
  ]);
  const { items, rejected } = validateVocabulary(raw);
  assert.equal(items.length, 1);
  assert.equal(rejected, 1);
});

test("validateVocabulary returns empty for unparseable/empty output", () => {
  assert.deepEqual(validateVocabulary("garbage"), { items: [], rejected: 0 });
  assert.deepEqual(validateVocabulary("[]"), { items: [], rejected: 0 });
});

// ---- quiz -----------------------------------------------------------------

test("validateQuiz keeps well-formed questions", () => {
  const raw = JSON.stringify([
    { question: "Q1?", options: ["a", "b", "c"], correctIndex: 1 },
    { question: "Q2?", options: ["yes", "no"], correctIndex: 0 },
  ]);
  const { items, rejected } = validateQuiz(raw);
  assert.equal(items.length, 2);
  assert.equal(rejected, 0);
});

test("validateQuiz rejects <2 options or out-of-range correctIndex", () => {
  const raw = JSON.stringify([
    { question: "too few", options: ["only"], correctIndex: 0 },
    { question: "oob high", options: ["a", "b"], correctIndex: 5 },
    { question: "oob neg", options: ["a", "b"], correctIndex: -1 },
    { question: "", options: ["a", "b"], correctIndex: 0 },
    { question: "missing idx", options: ["a", "b"] },
    { question: "valid", options: ["a", "b"], correctIndex: 1 },
  ]);
  const { items, rejected } = validateQuiz(raw);
  assert.deepEqual(
    items.map((q) => q.question),
    ["valid"],
  );
  assert.equal(rejected, 5);
});

test("validateQuiz drops blank options before counting", () => {
  const raw = JSON.stringify([
    { question: "blanks", options: ["a", "", "  ", "b"], correctIndex: 1 },
  ]);
  const { items } = validateQuiz(raw);
  assert.deepEqual(items[0].options, ["a", "b"]);
});

test("validateQuiz dedups identical questions", () => {
  const raw = JSON.stringify([
    { question: "Same?", options: ["a", "b"], correctIndex: 0 },
    { question: "same?", options: ["c", "d"], correctIndex: 1 },
  ]);
  const { items, rejected } = validateQuiz(raw);
  assert.equal(items.length, 1);
  assert.equal(rejected, 1);
});

// ---- tags -----------------------------------------------------------------

test("validateTags title-cases, dedups by slug, drops empties", () => {
  const raw = JSON.stringify(["Tech", "tech", "AI", "", "  ", "Climate Change"]);
  const { items, rejected } = validateTags(raw, slugify);
  assert.deepEqual(items, ["Tech", "AI", "Climate Change"]);
  assert.equal(rejected, 3);
});

test("validateTags rejects non-string entries", () => {
  const raw = JSON.stringify(["Valid", 42, null, { x: 1 }]);
  const { items, rejected } = validateTags(raw, slugify);
  assert.deepEqual(items, ["Valid"]);
  assert.equal(rejected, 3);
});

test("validateTags returns empty for unparseable output", () => {
  assert.deepEqual(validateTags("not json", slugify), { items: [], rejected: 0 });
});
