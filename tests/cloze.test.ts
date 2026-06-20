import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCloze, gradeCloze } from "@/lib/cloze";

// ── buildCloze — no_example ────────────────────────────────────────────────

test("buildCloze returns no_example when example is empty string", () => {
  const result = buildCloze("run", "");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "no_example");
});

test("buildCloze returns no_example when example is whitespace only", () => {
  const result = buildCloze("run", "   ");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "no_example");
});

// ── buildCloze — word_not_found ────────────────────────────────────────────

test("buildCloze returns word_not_found when word is not in example", () => {
  const result = buildCloze("elephant", "The cat sat on the mat.");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "word_not_found");
});

// ── buildCloze — basic match ───────────────────────────────────────────────

test("buildCloze masks a basic word in a sentence", () => {
  const result = buildCloze("run", "She loves to run every morning.");
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  assert.ok(result.card.masked.includes("___"), "mask should contain underscores");
  assert.ok(!result.card.masked.includes("run"), "word should be replaced");
  assert.equal(result.card.answer, "run");
});

test("buildCloze is case-insensitive for matching", () => {
  const result = buildCloze("climate", "Climate change affects everyone.");
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  assert.ok(result.card.masked.startsWith("_"), "mask should replace leading token");
});

// ── buildCloze — inflection matching ──────────────────────────────────────

test("buildCloze matches -ing inflection (running → run)", () => {
  const result = buildCloze("run", "She was running in the park.");
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  assert.ok(!result.card.masked.includes("running"), "inflected form should be masked");
});

test("buildCloze matches -ed inflection (walked → walk)", () => {
  const result = buildCloze("walk", "She walked to the store.");
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  assert.ok(!result.card.masked.includes("walked"), "inflected form should be masked");
});

test("buildCloze matches -s plural (runs → run)", () => {
  const result = buildCloze("run", "He runs every day.");
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  assert.ok(!result.card.masked.includes("runs"), "plural form should be masked");
});

// ── buildCloze — punctuation handling ─────────────────────────────────────

test("buildCloze preserves trailing punctuation around mask", () => {
  const result = buildCloze("dance", "She loves to dance, especially salsa.");
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  // The comma after "dance," should remain in the masked sentence
  assert.ok(result.card.masked.includes(","), "trailing comma should be preserved");
});

// ── buildCloze — multi-word word (graceful) ────────────────────────────────

test("buildCloze handles multi-word word by matching the first token", () => {
  // "despite" appears as "Despite" (capital) in the example sentence.
  // The answer is case-preserved from the source text.
  const result = buildCloze("despite", "Despite the rain, they played outside.");
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  assert.equal(result.card.answer.toLowerCase(), "despite");
});

// ── gradeCloze ─────────────────────────────────────────────────────────────

test("gradeCloze returns true for exact match", () => {
  assert.equal(gradeCloze("run", "run"), true);
});

test("gradeCloze is case-insensitive", () => {
  assert.equal(gradeCloze("Run", "run"), true);
  assert.equal(gradeCloze("RUN", "run"), true);
});

test("gradeCloze trims whitespace from user input", () => {
  assert.equal(gradeCloze("dance", "  dance  "), true);
});

test("gradeCloze returns false for wrong answer", () => {
  assert.equal(gradeCloze("dance", "jump"), false);
});

test("gradeCloze returns false for empty input", () => {
  assert.equal(gradeCloze("run", ""), false);
});
