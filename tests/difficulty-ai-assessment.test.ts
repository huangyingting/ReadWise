process.env.LOG_LEVEL = "error";

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

let completion = "The best CEFR estimate is C2.";

before(() => {
  mock.module("@/lib/ai", {
    namedExports: {
      chatComplete: async () => completion,
      isAiConfigured: () => true,
    },
  });
});

test("assessDifficulty returns AI level and score when provider returns a valid CEFR token", async () => {
  const { assessDifficulty } = await import("@/lib/difficulty");
  const result = await assessDifficulty(
    "Neutral title",
    `<p>${"The learners read a calm article with ordinary sentences. ".repeat(12)}</p>`,
  );

  assert.deepEqual(result, { level: "C2", score: 92, source: "ai" });
});

test("assessDifficulty falls back to heuristic when AI output has no CEFR token", async () => {
  completion = "I cannot determine the level.";
  const { assessDifficulty } = await import("@/lib/difficulty");
  const result = await assessDifficulty("Neutral title", "<p>tiny</p>");

  assert.deepEqual(result, { level: "B1", score: 50, source: "heuristic" });
});
