/**
 * Scores translations produced by `translate.ts`: cheap deterministic
 * heuristics plus an LLM-judge pass (the same vLLM server, prompted to score
 * adequacy/fluency/terminology/register).
 *
 * Privacy/content note: reads article text + translations from
 * `.translation-lab/translations.json` (gitignored). Prints ONLY aggregated
 * per-variant metrics to the console; the full per-sample detail (including
 * source/translation text, needed for manual spot-checking) is written to a
 * gitignored scratch file, never to stdout or a committed path.
 *
 * Usage:
 *   npm run node-ts -- scripts/translation-prompt-lab/evaluate.ts \
 *     --corpus .translation-lab/corpus.json \
 *     --translations .translation-lab/translations.json \
 *     --detail-out .translation-lab/eval-detail.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Corpus, SampledArticle } from "./sample";
import type { RunReport, TranslationRun } from "./translate";
import { chatCompleteWithRetry } from "./vllm-client";
import { isMain, parseString, runScript, warnUnknown } from "../lib/cli";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DEFAULT_CORPUS = `${REPO_ROOT}/.translation-lab/corpus.json`;
const DEFAULT_TRANSLATIONS = `${REPO_ROOT}/.translation-lab/translations.json`;
const DEFAULT_DETAIL_OUT = `${REPO_ROOT}/.translation-lab/eval-detail.json`;
const DEFAULT_SUMMARY_OUT = `${REPO_ROOT}/.translation-lab/eval-summary.json`;

export type Heuristics = {
  nonEmpty: boolean;
  noFences: boolean;
  paragraphMatch: boolean;
  cjkRatio: number;
  cjkRatioOk: boolean;
  lengthRatio: number;
  lengthRatioOk: boolean;
};

export type JudgeScore = {
  adequacy: number;
  fluency: number;
  terminology: number;
  register: number;
  issues: string[];
};

export type EvaluatedRun = {
  sampleId: string;
  providerDb: string;
  category: string;
  variantId: string;
  heuristics: Heuristics;
  judge: JudgeScore | null;
  judgeError: string | null;
};

const CJK_RE = /[\u4e00-\u9fff]/g;

function computeHeuristics(source: SampledArticle, run: TranslationRun): Heuristics {
  const text = run.translation ?? "";
  const nonWhitespace = text.replace(/\s+/g, "");
  const cjkCount = (text.match(CJK_RE) ?? []).length;
  const cjkRatio = nonWhitespace.length > 0 ? cjkCount / nonWhitespace.length : 0;
  const lengthRatio = source.charCount > 0 ? run.outputCharCount / source.charCount : 0;
  return {
    nonEmpty: text.length > 0,
    noFences: !text.includes("```"),
    paragraphMatch: run.outputParagraphCount === run.sourceParagraphCount,
    cjkRatio,
    // News/technical excerpts legitimately keep several proper nouns/acronyms
    // in Latin script (organizations, drug/gene names, team names); 0.7 is a
    // sanity floor that still catches "translation" that echoed the source
    // untouched, not a strict fluency gate (the LLM judge covers fluency).
    cjkRatioOk: cjkRatio >= 0.7,
    lengthRatio,
    lengthRatioOk: lengthRatio >= 0.12 && lengthRatio <= 1.1,
  };
}

const JUDGE_SYSTEM_PROMPT =
  "You are a meticulous bilingual English-to-Chinese translation quality " +
  "reviewer. You will receive an English source excerpt, its content " +
  "category, and a candidate Simplified Chinese translation. Score the " +
  "translation from 1 (very poor) to 5 (excellent) on: " +
  "adequacy (faithfulness/completeness vs. the source), " +
  "fluency (natural, idiomatic zh-CN prose, not stiff/literal), " +
  "terminology (domain-appropriate terms and proper-noun handling for this " +
  "category), and register (tone/formality appropriate for this category's " +
  "audience). List up to 3 concise concerns (empty array if none). " +
  'Respond with ONLY a single JSON object, no other text: ' +
  '{"adequacy": <1-5>, "fluency": <1-5>, "terminology": <1-5>, "register": <1-5>, "issues": ["..."]}';

function buildJudgeUser(source: SampledArticle, translation: string): string {
  return (
    `Category: ${source.category}\n\n` +
    `English source:\n${source.text}\n\n` +
    `Chinese translation:\n${translation}`
  );
}

function parseJudgeJson(raw: string): JudgeScore {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("judge response contained no JSON object");
  const parsed = JSON.parse(match[0]) as Partial<JudgeScore>;
  const clamp = (n: unknown): number => {
    const v = typeof n === "number" ? n : Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.min(5, Math.max(1, Math.round(v)));
  };
  return {
    adequacy: clamp(parsed.adequacy),
    fluency: clamp(parsed.fluency),
    terminology: clamp(parsed.terminology),
    register: clamp(parsed.register),
    issues: Array.isArray(parsed.issues) ? parsed.issues.map(String).slice(0, 3) : [],
  };
}

async function judgeOne(source: SampledArticle, translation: string): Promise<JudgeScore> {
  const result = await chatCompleteWithRetry(
    [
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      { role: "user", content: buildJudgeUser(source, translation) },
    ],
    { temperature: 0, maxTokens: 512 },
  );
  return parseJudgeJson(result.text);
}

export async function evaluateRuns(corpus: Corpus, report: RunReport): Promise<EvaluatedRun[]> {
  const bySampleId = new Map(corpus.articles.map((a) => [a.sampleId, a]));
  const out: EvaluatedRun[] = [];
  let i = 0;
  for (const run of report.runs) {
    i++;
    const source = bySampleId.get(run.sampleId);
    if (!source) {
      console.warn(`Skipping ${run.sampleId}: not found in corpus (was it re-sampled?)`);
      continue;
    }
    const heuristics = computeHeuristics(source, run);
    let judge: JudgeScore | null = null;
    let judgeError: string | null = null;
    if (run.translation) {
      try {
        judge = await judgeOne(source, run.translation);
      } catch (err) {
        judgeError = err instanceof Error ? err.message : String(err);
      }
    } else {
      judgeError = "no translation to judge (translate.ts run errored)";
    }
    console.log(`[${i}/${report.runs.length}] ${run.providerDb}/${run.category} × ${run.variantId} — judged`);
    out.push({
      sampleId: run.sampleId,
      providerDb: run.providerDb,
      category: run.category,
      variantId: run.variantId,
      heuristics,
      judge,
      judgeError,
    });
  }
  return out;
}

type VariantSummary = {
  variantId: string;
  n: number;
  paragraphMatchRate: number;
  cjkRatioOkRate: number;
  lengthRatioOkRate: number;
  meanAdequacy: number;
  meanFluency: number;
  meanTerminology: number;
  meanRegister: number;
  meanOverall: number;
};

export function summarizeByVariant(evaluated: EvaluatedRun[]): VariantSummary[] {
  const byVariant = new Map<string, EvaluatedRun[]>();
  for (const e of evaluated) {
    byVariant.set(e.variantId, [...(byVariant.get(e.variantId) ?? []), e]);
  }
  const mean = (nums: number[]): number => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);
  const rate = (bools: boolean[]): number => (bools.length ? bools.filter(Boolean).length / bools.length : 0);
  const summaries: VariantSummary[] = [];
  for (const [variantId, runs] of byVariant) {
    const judged = runs.filter((r) => r.judge);
    const adequacy = mean(judged.map((r) => r.judge!.adequacy));
    const fluency = mean(judged.map((r) => r.judge!.fluency));
    const terminology = mean(judged.map((r) => r.judge!.terminology));
    const register = mean(judged.map((r) => r.judge!.register));
    summaries.push({
      variantId,
      n: runs.length,
      paragraphMatchRate: rate(runs.map((r) => r.heuristics.paragraphMatch)),
      cjkRatioOkRate: rate(runs.map((r) => r.heuristics.cjkRatioOk)),
      lengthRatioOkRate: rate(runs.map((r) => r.heuristics.lengthRatioOk)),
      meanAdequacy: adequacy,
      meanFluency: fluency,
      meanTerminology: terminology,
      meanRegister: register,
      meanOverall: mean([adequacy, fluency, terminology, register]),
    });
  }
  return summaries.sort((a, b) => a.variantId.localeCompare(b.variantId));
}

function printSummaryTable(summaries: VariantSummary[]): void {
  const header = [
    "variant",
    "n",
    "para%",
    "cjk%",
    "len%",
    "adeq",
    "flu",
    "term",
    "reg",
    "overall",
  ];
  const rows = summaries.map((s) => [
    s.variantId,
    String(s.n),
    (s.paragraphMatchRate * 100).toFixed(0),
    (s.cjkRatioOkRate * 100).toFixed(0),
    (s.lengthRatioOkRate * 100).toFixed(0),
    s.meanAdequacy.toFixed(2),
    s.meanFluency.toFixed(2),
    s.meanTerminology.toFixed(2),
    s.meanRegister.toFixed(2),
    s.meanOverall.toFixed(2),
  ]);
  const widths = header.map((h, idx) => Math.max(h.length, ...rows.map((r) => r[idx]!.length)));
  const line = (cols: string[]) => cols.map((c, idx) => c.padEnd(widths[idx]!)).join("  ");
  console.log(line(header));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const row of rows) console.log(line(row));
}

type Args = { corpus: string; translations: string; detailOut: string; summaryOut: string; help: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = {
    corpus: parseString(argv, "--corpus") ?? DEFAULT_CORPUS,
    translations: parseString(argv, "--translations") ?? DEFAULT_TRANSLATIONS,
    detailOut: parseString(argv, "--detail-out") ?? DEFAULT_DETAIL_OUT,
    summaryOut: parseString(argv, "--summary-out") ?? DEFAULT_SUMMARY_OUT,
    help: argv.includes("--help") || argv.includes("-h"),
  };
  const known = new Set(["--corpus", "--translations", "--detail-out", "--summary-out", "--help", "-h"]);
  for (let i = 0; i < argv.length; i++) {
    if (known.has(argv[i])) {
      if (argv[i] !== "--help" && argv[i] !== "-h") i++;
      continue;
    }
    warnUnknown(argv[i]);
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: evaluate.ts [--corpus path] [--translations path] [--detail-out path] [--summary-out path]",
    );
    return 0;
  }
  if (!existsSync(args.corpus) || !existsSync(args.translations)) {
    console.error("Missing corpus or translations file. Run sample.ts then translate.ts first.");
    return 2;
  }
  const corpus = JSON.parse(readFileSync(args.corpus, "utf8")) as Corpus;
  const report = JSON.parse(readFileSync(args.translations, "utf8")) as RunReport;
  const evaluated = await evaluateRuns(corpus, report);
  const summaries = summarizeByVariant(evaluated);

  mkdirSync(dirname(args.detailOut), { recursive: true });
  writeFileSync(args.detailOut, JSON.stringify(evaluated, null, 2));
  writeFileSync(args.summaryOut, JSON.stringify(summaries, null, 2));

  console.log("");
  printSummaryTable(summaries);
  console.log(`\nWrote per-sample detail (article text — do not commit) to ${args.detailOut}`);
  console.log(`Wrote aggregate summary to ${args.summaryOut}`);
  return 0;
}

if (isMain(import.meta.url)) {
  runScript(main, "evaluate failed");
}
