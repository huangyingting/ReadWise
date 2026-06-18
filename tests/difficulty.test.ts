import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fleschReadingEase,
  heuristicDifficulty,
  parseLevel,
  levelRank,
  isDifficultyLevel,
} from "@/lib/difficulty";

test("fleschReadingEase returns null for too-little text", () => {
  assert.equal(fleschReadingEase("Short text."), null);
});

test("fleschReadingEase scores longer text and easy reads higher than hard", () => {
  const easy = Array.from({ length: 30 }, () => "The cat sat on the mat.").join(" ");
  const hard = Array.from(
    { length: 30 },
    () => "Consequently, the multifaceted epistemological framework necessitates reconsideration.",
  ).join(" ");
  const easyScore = fleschReadingEase(easy);
  const hardScore = fleschReadingEase(hard);
  assert.ok(easyScore !== null && hardScore !== null);
  assert.ok((easyScore as number) > (hardScore as number));
});

test("heuristicDifficulty returns a CEFR level + 0..100 score", () => {
  const text = "<p>" + Array.from({ length: 40 }, () => "The dog ran fast.").join(" ") + "</p>";
  const { level, score } = heuristicDifficulty(text);
  assert.ok(isDifficultyLevel(level));
  assert.ok(score >= 0 && score <= 100);
});

test("heuristicDifficulty falls back to B1/50 when unscorable", () => {
  assert.deepEqual(heuristicDifficulty("<p>tiny</p>"), { level: "B1", score: 50 });
});

test("parseLevel extracts the first CEFR token from model output", () => {
  assert.equal(parseLevel("The level is b2 overall."), "B2");
  assert.equal(parseLevel("A1"), "A1");
  assert.equal(parseLevel("no level here"), null);
});

test("levelRank and isDifficultyLevel", () => {
  assert.equal(levelRank("A1"), 0);
  assert.equal(levelRank("C2"), 5);
  assert.equal(levelRank("ZZ"), -1);
  assert.equal(isDifficultyLevel("B1"), true);
  assert.equal(isDifficultyLevel("XX"), false);
  assert.equal(isDifficultyLevel(7), false);
});
