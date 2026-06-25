/**
 * AI evaluation harness (RW-021).
 *
 * AI features can regress silently when prompts, models, or parsing logic
 * change. This harness runs each feature's parser/validator/output rules against
 * a small CURATED dataset of representative inputs + expected INVARIANTS (not
 * exact provider output) and scores how many properties hold. It powers:
 *
 *   - A deterministic OFFLINE mode (the default, used in CI): each dataset case
 *     carries a representative `modelOutput`, which is fed through the real
 *     feature parsers/validators. No provider credentials, DB, or network are
 *     needed — so prompt/model/parsing regressions are caught without secrets.
 *   - An optional LIVE mode (staging/manual): the active prompt is rendered via
 *     the {@link import("@/lib/ai/prompts") prompt registry} and sent to the
 *     configured provider; the SAME property checks run against the live output.
 *
 * Properties are intentionally semantic invariants ("a quiz has >=2 options and
 * a valid correctIndex", "difficulty is a valid CEFR token", "vocab items have
 * word+explanation", "a translation preserves paragraph count"), so the suite is
 * robust to wording differences between model runs while still catching real
 * breakage. The report is JSON-serializable and comparable across runs over time
 * (see docs/ai-evals.md).
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  renderPrompt,
  activePromptVersion,
  type PromptMessage,
} from "@/lib/ai/prompts";
import { validateVocabulary, validateQuiz } from "@/lib/ai/output/validators";
import { parseLevel, isDifficultyLevel } from "@/lib/difficulty";
import { moderateText } from "@/lib/ai/output/moderation";

// ---------------------------------------------------------------------------
// Dataset & report shapes
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Feature evaluators
// ---------------------------------------------------------------------------

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

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function pass(name: string, condition: boolean, detail?: string): EvalPropertyResult {
  return { name, passed: condition, detail: condition ? undefined : detail };
}

/** Counts blank-line-separated paragraphs in plain text. */
function paragraphCount(text: string): number {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0).length;
}

/** Whether the text contains any HTML-like tag. */
function containsHtml(text: string): boolean {
  return /<[a-z!/][^>]*>/i.test(text);
}

const translationEvaluator: FeatureEvaluator = {
  feature: "translation",
  buildMessages: (input) =>
    renderPrompt("translation", {
      label: str(input.targetLangLabel, str(input.targetLang, "Spanish")),
      title: str(input.title),
      chunk: str(input.source),
      isPart: false,
    }),
  check: (output, input) => {
    const trimmed = output.trim();
    const expectedParagraphs = paragraphCount(str(input.source));
    const gotParagraphs = paragraphCount(trimmed);
    return [
      pass("non-empty", trimmed.length > 0, "translation was empty"),
      pass("no-markdown-fences", !trimmed.includes("```"), "output contained code fences"),
      pass(
        "preserves-paragraph-count",
        gotParagraphs === expectedParagraphs,
        `expected ${expectedParagraphs} paragraphs, got ${gotParagraphs}`,
      ),
    ];
  },
};

const vocabularyEvaluator: FeatureEvaluator = {
  feature: "vocabulary",
  buildMessages: (input) =>
    renderPrompt("vocabulary", { title: str(input.title), source: str(input.source) }),
  check: (output, _input, expect) => {
    const { items } = validateVocabulary(output);
    const minItems = num(expect.minItems, 1);
    const allHaveWordAndExplanation = items.every(
      (i) => i.word.trim().length > 0 && i.explanation.trim().length > 0,
    );
    const uniqueWords = new Set(items.map((i) => i.word.toLowerCase())).size;
    return [
      pass("parses-min-items", items.length >= minItems, `parsed ${items.length} < ${minItems}`),
      pass(
        "items-have-word-and-explanation",
        allHaveWordAndExplanation,
        "an item was missing word or explanation",
      ),
      pass("no-duplicate-words", uniqueWords === items.length, "duplicate words present"),
    ];
  },
};

const quizEvaluator: FeatureEvaluator = {
  feature: "quiz",
  buildMessages: (input) =>
    renderPrompt("quiz", { title: str(input.title), source: str(input.source) }),
  check: (output, _input, expect) => {
    const { items } = validateQuiz(output);
    const minItems = num(expect.minItems, 1);
    const allHave2Plus = items.every((q) => q.options.length >= 2);
    const allValidIndex = items.every(
      (q) => q.correctIndex >= 0 && q.correctIndex < q.options.length,
    );
    return [
      pass("parses-min-items", items.length >= minItems, `parsed ${items.length} < ${minItems}`),
      pass("each-has-2plus-options", allHave2Plus, "a question had fewer than 2 options"),
      pass("valid-correct-index", allValidIndex, "a question had an out-of-range correctIndex"),
    ];
  },
};

const difficultyEvaluator: FeatureEvaluator = {
  feature: "difficulty",
  buildMessages: (input) =>
    renderPrompt("difficulty", { title: str(input.title), source: str(input.source) }),
  check: (output, _input, expect) => {
    const level = parseLevel(output);
    const results: EvalPropertyResult[] = [
      pass("valid-cefr-token", level != null, `could not parse a CEFR level from "${output}"`),
    ];
    const expected = str(expect.level);
    if (expected) {
      results.push(
        pass(
          "matches-expected-band",
          isDifficultyLevel(expected) && level === expected,
          `expected ${expected}, got ${level ?? "none"}`,
        ),
      );
    }
    return results;
  },
};

const grammarEvaluator: FeatureEvaluator = {
  feature: "grammar",
  buildMessages: (input) =>
    renderPrompt("grammar", {
      phrase: str(input.phrase),
      context: str(input.context),
      level: str(input.level, "B1"),
    }),
  check: (output) => {
    const trimmed = output.trim();
    return [
      pass("non-empty", trimmed.length > 0, "explanation was empty"),
      pass("no-html", !containsHtml(trimmed), "explanation contained HTML"),
      pass("not-flagged", !moderateText(trimmed).flagged, "explanation tripped moderation"),
    ];
  },
};

const tutorEvaluator: FeatureEvaluator = {
  feature: "tutor",
  buildMessages: (input) =>
    renderPrompt("tutor", {
      level: str(input.level, "B1"),
      title: str(input.title),
      articleText: str(input.articleText),
      question: str(input.question),
    }),
  check: (output, _input, expect) => {
    const trimmed = output.trim();
    const results: EvalPropertyResult[] = [
      pass("non-empty", trimmed.length > 0, "answer was empty"),
      pass("no-html", !containsHtml(trimmed), "answer contained HTML"),
      pass("not-flagged", !moderateText(trimmed).flagged, "answer tripped moderation"),
    ];
    const mustInclude = Array.isArray(expect.mustInclude)
      ? (expect.mustInclude as unknown[]).map((t) => String(t).toLowerCase())
      : [];
    if (mustInclude.length > 0) {
      const lower = trimmed.toLowerCase();
      const missing = mustInclude.filter((t) => !lower.includes(t));
      results.push(
        pass("grounded-in-article", missing.length === 0, `missing terms: ${missing.join(", ")}`),
      );
    }
    return results;
  },
};

/** Evaluators keyed by feature. Every curated dataset must have one. */
export const EVALUATORS: Record<string, FeatureEvaluator> = {
  translation: translationEvaluator,
  vocabulary: vocabularyEvaluator,
  quiz: quizEvaluator,
  difficulty: difficultyEvaluator,
  grammar: grammarEvaluator,
  tutor: tutorEvaluator,
};

/** Features that have an evaluator (and therefore can be evaluated). */
export const EVALUABLE_FEATURES = Object.keys(EVALUATORS);

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

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

/** Default LIVE model caller — renders are sent through the real chat client. */
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

// ---------------------------------------------------------------------------
// Dataset loading
// ---------------------------------------------------------------------------

/** Absolute path to the curated evaluation datasets directory. */
export function evalDatasetsDir(): string {
  // <root>/src/lib/ai/eval.ts → <root>/evals
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "evals");
}

/** Loads and parses every `*.json` dataset from the evals directory. */
export function loadEvalDatasets(dir: string = evalDatasetsDir()): EvalDataset[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  return files.map((file) => {
    const raw = readFileSync(path.join(dir, file), "utf8");
    const parsed = JSON.parse(raw) as EvalDataset;
    if (!parsed.feature || !Array.isArray(parsed.cases)) {
      throw new Error(`Invalid eval dataset: ${file}`);
    }
    return parsed;
  });
}

/** A flat list of every property failure (for concise CI assertions/logs). */
export function collectFailures(report: EvalReport): Array<{
  feature: string;
  caseName: string;
  property: string;
  detail?: string;
}> {
  const failures: Array<{ feature: string; caseName: string; property: string; detail?: string }> =
    [];
  for (const feature of report.features) {
    for (const caseResult of feature.cases) {
      for (const property of caseResult.properties) {
        if (!property.passed) {
          failures.push({
            feature: feature.feature,
            caseName: caseResult.caseName,
            property: property.name,
            detail: property.detail,
          });
        }
      }
    }
  }
  return failures;
}
