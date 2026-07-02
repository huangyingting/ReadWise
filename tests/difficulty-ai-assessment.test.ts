process.env.LOG_LEVEL = "error";

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

let calls = 0;

before(() => {
  mock.module("@/lib/ai", {
    namedExports: {
      chatComplete: async () => {
        calls += 1;
        throw new Error("difficulty must not call AI");
      },
      isAiConfigured: () => true,
    },
  });
});

test("assessDifficulty ignores configured AI and stays deterministic", async () => {
  const { assessDifficulty } = await import("@/lib/difficulty");
  const result = await assessDifficulty(
    "Neutral title",
    `<p>${"The learners read a calm article with ordinary sentences. ".repeat(12)}</p>`,
  );

  assert.equal(calls, 0);
  assert.equal(result.source, "deterministic");
  assert.ok(result.lexileApprox >= 200 && result.lexileApprox <= 1600);
});
