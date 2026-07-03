process.env.LOG_LEVEL = "error";

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import type { EvalDataset } from "@/lib/ai/evals/types";

let calls = 0;
const VALID_QUIZ_OUTPUT = '[{"question":"Q?","options":["A","B"],"correctIndex":0}]';

let output: string | null = VALID_QUIZ_OUTPUT;

function liveQuizDataset(name: string, expect?: EvalDataset["cases"][number]["expect"]): EvalDataset {
  return {
    feature: "quiz",
    cases: [{ name, input: { title: "T", source: "S" }, ...(expect ? { expect } : {}) }],
  };
}

before(() => {
  mock.module("@/lib/ai", {
    namedExports: {
      chatComplete: async () => {
        calls++;
        return output;
      },
      isAiConfigured: () => false,
      aiModelName: () => null,
    },
  });
});

test("live evaluation uses the lazy default model caller", async () => {
  const { evaluateDataset } = await import("@/lib/ai/evals/live-runner");
  const report = await evaluateDataset(liveQuizDataset("default-live", { minItems: 1 }), { live: true });

  assert.equal(calls, 1);
  assert.equal(report.casesPassed, 1);
});

test("live evaluation records a failed property when the default caller returns null", async () => {
  const { evaluateDataset } = await import("@/lib/ai/evals/live-runner");
  output = null;
  const report = await evaluateDataset(liveQuizDataset("default-live-empty"), { live: true });

  assert.equal(report.casesPassed, 0);
  assert.equal(report.cases[0].properties[0].detail, "live provider returned no output");
});
