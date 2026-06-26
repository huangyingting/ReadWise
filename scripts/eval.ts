/**
 * AI evaluation CLI (RW-021).
 *
 *   npm run eval                     # offline deterministic run over evals/*.json
 *   npm run eval -- --feature quiz   # only one feature dataset
 *   npm run eval -- --json           # machine-readable report on stdout
 *   npm run eval -- --out report.json
 *   npm run eval -- --live           # call the configured provider (staging/manual)
 *
 * Offline mode (default) feeds each dataset's representative `modelOutput`
 * through the real feature parsers/validators and scores property satisfaction —
 * no provider credentials, DB, or network required. Live mode renders the active
 * prompt via the registry and calls the provider; the same property checks run
 * against the live output. Exit code is non-zero when any property fails.
 */

import { writeFileSync } from "node:fs";
import { loadEvalDatasets } from "@/lib/ai/evals/datasets";
import { runEvaluation } from "@/lib/ai/evals/live-runner";
import { collectFailures } from "@/lib/ai/evals/report";
import { EVALUABLE_FEATURES } from "@/lib/ai/evals/registry";
import type { EvalReport } from "@/lib/ai/evals/types";
import { isAiConfigured } from "@/lib/ai";
import { runScript, isMain, warnUnknown } from "./lib/cli";

type Args = {
  live: boolean;
  json: boolean;
  feature: string | null;
  out: string | null;
  help: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { live: false, json: false, feature: null, out: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--live":
        args.live = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--feature":
        args.feature = argv[++i] ?? null;
        break;
      case "--out":
        args.out = argv[++i] ?? null;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        if (arg.startsWith("-")) {
          warnUnknown(arg);
        }
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`AI evaluation harness (RW-021)

Usage:
  npm run eval                      Run the offline deterministic evaluation
  npm run eval -- --feature <name>  Evaluate only one feature dataset
  npm run eval -- --json            Print the JSON report to stdout
  npm run eval -- --out <path>      Write the JSON report to a file
  npm run eval -- --live            Use the configured provider (staging/manual)

Evaluable features: ${EVALUABLE_FEATURES.join(", ")}
`);
}

function pct(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}

function printConsoleReport(report: EvalReport): void {
  console.log(`\nAI evaluation report (${report.mode}) — ${report.generatedAt}`);
  console.log("=".repeat(64));
  for (const feature of report.features) {
    const version = report.promptVersions[feature.feature] ?? "(unknown)";
    console.log(
      `\n${feature.feature}  [${version}]  ` +
        `cases ${feature.casesPassed}/${feature.caseCount}  ` +
        `properties ${feature.propertiesPassed}/${feature.propertiesChecked}  ` +
        `score ${pct(feature.score)}`,
    );
    for (const caseResult of feature.cases) {
      const mark = caseResult.passed ? "PASS" : "FAIL";
      console.log(
        `  [${mark}] ${caseResult.caseName} ` +
          `(${caseResult.propertiesPassed}/${caseResult.propertiesChecked})`,
      );
      for (const property of caseResult.properties) {
        if (!property.passed) {
          console.log(`        ✗ ${property.name}: ${property.detail ?? "failed"}`);
        }
      }
    }
  }
  console.log("\n" + "=".repeat(64));
  console.log(
    `TOTAL  cases ${report.totals.casesPassed}/${report.totals.caseCount}  ` +
      `properties ${report.totals.propertiesPassed}/${report.totals.propertiesChecked}  ` +
      `score ${pct(report.totals.score)}`,
  );
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  let datasets = loadEvalDatasets();
  if (args.feature) {
    datasets = datasets.filter((d) => d.feature === args.feature);
    if (datasets.length === 0) {
      console.error(`No dataset found for feature "${args.feature}".`);
      return 2;
    }
  }

  if (args.live && !isAiConfigured()) {
    console.error("--live requires AI provider credentials (AZURE_OPENAI_*). Aborting.");
    return 2;
  }

  const report = await runEvaluation(datasets, { live: args.live });

  if (args.out) {
    writeFileSync(args.out, JSON.stringify(report, null, 2));
    console.error(`Wrote report to ${args.out}`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printConsoleReport(report);
  }

  const failures = collectFailures(report);
  if (failures.length > 0) {
    console.error(`\n${failures.length} property check(s) failed.`);
    return 1;
  }
  return 0;
}

export { parseArgs };

if (isMain(import.meta.url)) {
  runScript(main, "eval failed");
}
