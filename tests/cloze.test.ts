import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCloze, gradeCloze } from "@/lib/learning/cloze";

function assertClozeFailure(word: string, example: string, reason: string) {
  const result = buildCloze(word, example);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, reason);
}

function assertClozeCard(word: string, example: string) {
  const result = buildCloze(word, example);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  return result.card;
}

// ── buildCloze — no_example ────────────────────────────────────────────────

for (const [name, example] of [
  ["empty string", ""],
  ["whitespace only", "   "],
] as const) {
  test(`buildCloze returns no_example when example is ${name}`, () => {
    assertClozeFailure("run", example, "no_example");
  });
}

// ── buildCloze — word_not_found ────────────────────────────────────────────

test("buildCloze returns word_not_found when word is not in example", () => {
  assertClozeFailure("elephant", "The cat sat on the mat.", "word_not_found");
});

// ── buildCloze — basic match ───────────────────────────────────────────────

test("buildCloze masks a basic word in a sentence", () => {
  const card = assertClozeCard("run", "She loves to run every morning.");
  assert.ok(card.masked.includes("___"), "mask should contain underscores");
  assert.ok(!card.masked.includes("run"), "word should be replaced");
  assert.equal(card.answer, "run");
});

test("buildCloze is case-insensitive for matching", () => {
  const card = assertClozeCard("climate", "Climate change affects everyone.");
  assert.ok(card.masked.startsWith("_"), "mask should replace leading token");
});

// ── buildCloze — inflection matching ──────────────────────────────────────

for (const { name, word, example, surface } of [
  {
    name: "-ing inflection (running → run)",
    word: "run",
    example: "She was running in the park.",
    surface: "running",
  },
  {
    name: "-ed inflection (walked → walk)",
    word: "walk",
    example: "She walked to the store.",
    surface: "walked",
  },
  {
    name: "-s plural (runs → run)",
    word: "run",
    example: "He runs every day.",
    surface: "runs",
  },
] as const) {
  test(`buildCloze matches ${name}`, () => {
    const card = assertClozeCard(word, example);
    assert.ok(!card.masked.includes(surface), "inflected form should be masked");
  });
}

// ── buildCloze — punctuation handling ─────────────────────────────────────

test("buildCloze preserves trailing punctuation around mask", () => {
  const card = assertClozeCard("dance", "She loves to dance, especially salsa.");
  // The comma after "dance," should remain in the masked sentence
  assert.ok(card.masked.includes(","), "trailing comma should be preserved");
});

// ── buildCloze — multi-word word (graceful) ────────────────────────────────

test("buildCloze handles multi-word word by matching the first token", () => {
  // "despite" appears as "Despite" (capital) in the example sentence.
  // The answer is case-preserved from the source text.
  const card = assertClozeCard("despite", "Despite the rain, they played outside.");
  assert.equal(card.answer.toLowerCase(), "despite");
});

// ── gradeCloze ─────────────────────────────────────────────────────────────

for (const { name, answer, input, expected } of [
  { name: "returns true for exact match", answer: "run", input: "run", expected: true },
  { name: "is case-insensitive for title case", answer: "Run", input: "run", expected: true },
  { name: "is case-insensitive for uppercase", answer: "RUN", input: "run", expected: true },
  { name: "trims whitespace from user input", answer: "dance", input: "  dance  ", expected: true },
  { name: "returns false for wrong answer", answer: "dance", input: "jump", expected: false },
  { name: "returns false for empty input", answer: "run", input: "", expected: false },
] as const) {
  test(`gradeCloze ${name}`, () => {
    assert.equal(gradeCloze(answer, input), expected);
  });
}
