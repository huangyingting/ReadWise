/**
 * AI evaluation harness (RW-021) — barrel re-export.
 *
 * The harness is modularized under `@/lib/ai/evals/`:
 *   types.ts        — dataset/result/report types
 *   assertions.ts   — shared property helpers (pass, containsHtml, …)
 *   datasets.ts     — dataset path resolution and loading
 *   registry.ts     — evaluator registry (EVALUATORS, EVALUABLE_FEATURES)
 *   live-runner.ts  — evaluateDataset, runEvaluation (lazy provider import)
 *   report.ts       — collectFailures
 *   evaluators/     — per-feature evaluator implementations
 *
 * This file re-exports the complete public surface so existing importers
 * (scripts/eval.ts, tests/ai-eval.test.ts, …) require no changes.
 */

export type {
  EvalCase,
  EvalDataset,
  EvalPropertyResult,
  EvalCaseResult,
  EvalFeatureReport,
  EvalReport,
  FeatureEvaluator,
  EvalModelCaller,
  RunOptions,
} from "@/lib/ai/evals/types";

export { EVALUATORS, EVALUABLE_FEATURES } from "@/lib/ai/evals/registry";
export { evalDatasetsDir, loadEvalDatasets } from "@/lib/ai/evals/datasets";
export { evaluateDataset, runEvaluation } from "@/lib/ai/evals/live-runner";
export { collectFailures } from "@/lib/ai/evals/report";
