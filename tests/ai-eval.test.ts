/**
 * AI evaluation deterministic regression tests (RW-021).
 *
 * Runs the OFFLINE evaluation (no provider credentials, DB, or network) over the
 * curated `evals/*.json` datasets and asserts every property invariant holds, so
 * a prompt/model/parsing regression fails CI. Also proves the property checks
 * have teeth by feeding a deliberately-broken output and asserting it fails.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  loadEvalDatasets,
  runEvaluation,
  evaluateDataset,
  collectFailures,
  EVALUABLE_FEATURES,
  type EvalDataset,
} from "@/lib/ai/eval";

test("every evaluable feature has at least one curated dataset", () => {
  const datasets = loadEvalDatasets();
  const features = new Set(datasets.map((d) => d.feature));
  for (const feature of EVALUABLE_FEATURES) {
    assert.ok(features.has(feature), `missing eval dataset for feature "${feature}"`);
  }
  // Every dataset has an evaluator + at least one case.
  for (const dataset of datasets) {
    assert.ok(EVALUABLE_FEATURES.includes(dataset.feature), `no evaluator for ${dataset.feature}`);
    assert.ok(dataset.cases.length >= 1, `dataset ${dataset.feature} has no cases`);
  }
});

test("offline evaluation passes every property for all curated datasets", async () => {
  const datasets = loadEvalDatasets();
  const report = await runEvaluation(datasets, { live: false });

  assert.equal(report.mode, "offline");
  const failures = collectFailures(report);
  assert.deepEqual(
    failures,
    [],
    `eval property failures:\n${failures
      .map((f) => `  ${f.feature}/${f.caseName}/${f.property}: ${f.detail ?? ""}`)
      .join("\n")}`,
  );
  assert.equal(report.totals.score, 1);
  assert.equal(report.totals.casesPassed, report.totals.caseCount);
  assert.ok(report.totals.caseCount >= EVALUABLE_FEATURES.length);
});

test("the report records the active prompt version per feature", async () => {
  const datasets = loadEvalDatasets();
  const report = await runEvaluation(datasets, { live: false });
  assert.equal(report.promptVersions.quiz, "quiz/v1");
  assert.equal(report.promptVersions.translation, "translation/v1");
});

test("property checks fail for a broken model output (regression sentinel)", async () => {
  // A quiz output with a single option and an out-of-range correctIndex must fail.
  const broken: EvalDataset = {
    feature: "quiz",
    cases: [
      {
        name: "broken",
        input: { title: "T", source: "S" },
        modelOutput: '[{"question":"Q?","options":["only one"],"correctIndex":5}]',
        expect: { minItems: 1 },
      },
    ],
  };
  const report = await evaluateDataset(broken, { live: false });
  assert.ok(report.score < 1, "a malformed quiz output must not score 100%");
  assert.equal(report.casesPassed, 0);
});

test("a missing modelOutput is reported as a failed property in offline mode", async () => {
  const noOutput: EvalDataset = {
    feature: "difficulty",
    cases: [{ name: "no-output", input: { title: "T", source: "S" } }],
  };
  const report = await evaluateDataset(noOutput, { live: false });
  assert.equal(report.casesPassed, 0);
  assert.equal(report.cases[0].properties[0].name, "provider-returned-output");
});

test("evaluating a dataset with an unknown feature throws", async () => {
  const unknown: EvalDataset = {
    feature: "nonexistent-feature",
    cases: [{ name: "x", input: {}, modelOutput: "anything" }],
  };
  await assert.rejects(
    () => evaluateDataset(unknown, { live: false }),
    /No evaluator registered for feature "nonexistent-feature"/,
  );
});

test("live mode routes through an injected model caller and re-checks the output", async () => {
  const dataset: EvalDataset = {
    feature: "difficulty",
    cases: [
      {
        name: "live-canned",
        input: { title: "T", source: "S" },
        expect: { level: "B2" },
      },
    ],
  };
  const calls: string[] = [];
  const report = await evaluateDataset(dataset, {
    live: true,
    callModel: async (_messages, feature) => {
      calls.push(feature);
      return "B2";
    },
  });
  assert.deepEqual(calls, ["difficulty"]);
  assert.equal(report.score, 1);
});
