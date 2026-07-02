process.env.LOG_LEVEL = "error";

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import type { EvalDataset } from "@/lib/ai/evals/types";

let calls = 0;
let output: string | null = '[{"question":"Q?","options":["A","B"],"correctIndex":0}]';

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
  const dataset: EvalDataset = {
    feature: "quiz",
    cases: [{ name: "default-live", input: { title: "T", source: "S" }, expect: { minItems: 1 } }],
  };

  const report = await evaluateDataset(dataset, { live: true });

  assert.equal(calls, 1);
  assert.equal(report.casesPassed, 1);
});

test("live evaluation records a failed property when the default caller returns null", async () => {
  const { evaluateDataset } = await import("@/lib/ai/evals/live-runner");
  output = null;
  const dataset: EvalDataset = {
    feature: "quiz",
    cases: [{ name: "default-live-empty", input: { title: "T", source: "S" } }],
  };

  const report = await evaluateDataset(dataset, { live: true });

  assert.equal(report.casesPassed, 0);
  assert.equal(report.cases[0].properties[0].detail, "live provider returned no output");
});
