/**
 * Runner: evaluates datasets against the registry in offline or live mode.
 * Live model caller is imported lazily so offline/CI runs never touch the
 * provider stack or require secrets.
 */

import { activePromptVersion } from "@/lib/ai/prompts";
import type {
  EvalDataset,
  EvalCaseResult,
  EvalFeatureReport,
  EvalReport,
  EvalPropertyResult,
  EvalModelCaller,
  RunOptions,
} from "@/lib/ai/evals/types";
import { EVALUATORS } from "@/lib/ai/evals/registry";

/** Default LIVE model caller — messages are sent through the real chat client. */
const defaultCallModel: EvalModelCaller = async (messages, feature) => {
  // Imported lazily so OFFLINE runs (and CI) never pull the provider stack.
  const { chatComplete } = await import("@/lib/ai");
  return chatComplete(messages, {
    feature,
    promptVersion: activePromptVersion(feature),
    kind: "interactive",
  });
};

function emptyProperty(name: string, detail: string): EvalPropertyResult {
  return { name, passed: false, detail };
}

/** Evaluates one dataset, returning a per-feature report. */
export async function evaluateDataset(
  dataset: EvalDataset,
  opts: RunOptions = {},
): Promise<EvalFeatureReport> {
  const evaluator = EVALUATORS[dataset.feature];
  if (!evaluator) {
    throw new Error(`No evaluator registered for feature "${dataset.feature}"`);
  }
  const callModel = opts.callModel ?? defaultCallModel;

  const caseResults: EvalCaseResult[] = [];
  for (const testCase of dataset.cases) {
    const input = testCase.input ?? {};
    const expect = testCase.expect ?? {};

    let output: string | null;
    if (opts.live) {
      output = await callModel(evaluator.buildMessages(input), dataset.feature);
    } else {
      output = testCase.modelOutput ?? null;
    }

    const properties =
      output == null
        ? [
            emptyProperty(
              "provider-returned-output",
              opts.live ? "live provider returned no output" : "case has no modelOutput",
            ),
          ]
        : evaluator.check(output, input, expect);

    const propertiesPassed = properties.filter((p) => p.passed).length;
    caseResults.push({
      feature: dataset.feature,
      caseName: testCase.name,
      properties,
      propertiesChecked: properties.length,
      propertiesPassed,
      passed: propertiesPassed === properties.length,
    });
  }

  const propertiesChecked = caseResults.reduce((s, c) => s + c.propertiesChecked, 0);
  const propertiesPassed = caseResults.reduce((s, c) => s + c.propertiesPassed, 0);
  return {
    feature: dataset.feature,
    description: dataset.description,
    cases: caseResults,
    caseCount: caseResults.length,
    casesPassed: caseResults.filter((c) => c.passed).length,
    propertiesChecked,
    propertiesPassed,
    score: propertiesChecked === 0 ? 1 : propertiesPassed / propertiesChecked,
  };
}

/** Evaluates multiple datasets and aggregates a single comparable report. */
export async function runEvaluation(
  datasets: EvalDataset[],
  opts: RunOptions = {},
): Promise<EvalReport> {
  const features: EvalFeatureReport[] = [];
  for (const dataset of datasets) {
    features.push(await evaluateDataset(dataset, opts));
  }

  const caseCount = features.reduce((s, f) => s + f.caseCount, 0);
  const casesPassed = features.reduce((s, f) => s + f.casesPassed, 0);
  const propertiesChecked = features.reduce((s, f) => s + f.propertiesChecked, 0);
  const propertiesPassed = features.reduce((s, f) => s + f.propertiesPassed, 0);

  const promptVersions: Record<string, string> = {};
  for (const f of features) {
    promptVersions[f.feature] = activePromptVersion(f.feature);
  }

  return {
    mode: opts.live ? "live" : "offline",
    generatedAt: new Date().toISOString(),
    promptVersions,
    features,
    totals: {
      caseCount,
      casesPassed,
      propertiesChecked,
      propertiesPassed,
      score: propertiesChecked === 0 ? 1 : propertiesPassed / propertiesChecked,
    },
  };
}
