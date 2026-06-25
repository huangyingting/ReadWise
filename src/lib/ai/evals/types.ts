/**
 * Shared types for the AI evaluation harness.
 */

import type { PromptMessage } from "@/lib/ai/prompts";

/** A single dataset case: input + a representative output + expected invariants. */
export type EvalCase = {
  name: string;
  input: Record<string, unknown>;
  /** Representative model output used in OFFLINE mode. */
  modelOutput?: string;
  /** Feature-specific expectations the properties are checked against. */
  expect?: Record<string, unknown>;
};

/** A curated dataset for one feature. */
export type EvalDataset = {
  feature: string;
  description?: string;
  cases: EvalCase[];
};

/** Result of a single property check. */
export type EvalPropertyResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

/** Result of evaluating one case (all its properties). */
export type EvalCaseResult = {
  feature: string;
  caseName: string;
  properties: EvalPropertyResult[];
  propertiesChecked: number;
  propertiesPassed: number;
  passed: boolean;
};

/** Aggregated results for one feature dataset. */
export type EvalFeatureReport = {
  feature: string;
  description?: string;
  cases: EvalCaseResult[];
  caseCount: number;
  casesPassed: number;
  propertiesChecked: number;
  propertiesPassed: number;
  /** propertiesPassed / propertiesChecked in [0,1] (1.0 when none checked). */
  score: number;
};

/** The full evaluation report across all features. */
export type EvalReport = {
  mode: "offline" | "live";
  generatedAt: string;
  promptVersions: Record<string, string>;
  features: EvalFeatureReport[];
  totals: {
    caseCount: number;
    casesPassed: number;
    propertiesChecked: number;
    propertiesPassed: number;
    score: number;
  };
};

/**
 * Per-feature glue: how to render the LIVE prompt from a case input, and how to
 * check a (canned or live) model output against the case's invariants.
 */
export type FeatureEvaluator = {
  feature: string;
  /** Builds the chat messages for a LIVE provider run from a case input. */
  buildMessages: (input: Record<string, unknown>) => PromptMessage[];
  /** Checks the output's semantic invariants; returns one result per property. */
  check: (
    output: string,
    input: Record<string, unknown>,
    expect: Record<string, unknown>,
  ) => EvalPropertyResult[];
};

/** Signature of the model caller used in LIVE mode. */
export type EvalModelCaller = (
  messages: PromptMessage[],
  feature: string,
) => Promise<string | null>;

export type RunOptions = {
  /** When true, call the provider for each case instead of using `modelOutput`. */
  live?: boolean;
  /** Override the model caller (LIVE mode). Defaults to `@/lib/ai.chatComplete`. */
  callModel?: EvalModelCaller;
};
