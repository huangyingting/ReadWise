process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

let datasets: Array<{ feature: string }> = [];
let aiConfigured = true;
let reportFailures: Array<{ feature: string; caseName: string; property: string }> = [];
let runEvaluationCalls: Array<{ datasetCount: number; live: boolean }> = [];
let writtenFiles: Array<{ path: string; content: string }> = [];
let evaluationReport: Record<string, unknown> = {};

const baseReport = {
  mode: "offline" as const,
  generatedAt: "2026-07-11T08:08:13.000Z",
  promptVersions: { quiz: "v1" },
  features: [
    {
      feature: "quiz",
      cases: [
        {
          feature: "quiz",
          caseName: "case-1",
          properties: [{ name: "shape", passed: true }],
          propertiesChecked: 1,
          propertiesPassed: 1,
          passed: true,
        },
      ],
      caseCount: 1,
      casesPassed: 1,
      propertiesChecked: 1,
      propertiesPassed: 1,
      score: 1,
    },
  ],
  totals: {
    caseCount: 1,
    casesPassed: 1,
    propertiesChecked: 1,
    propertiesPassed: 1,
    score: 1,
  },
};

before(() => {
  mock.module("node:fs", {
    namedExports: {
      writeFileSync: (filePath: string, content: string) => {
        writtenFiles.push({ path: filePath, content });
      },
    },
  });

  mock.module("@/lib/ai/evals/datasets", {
    namedExports: {
      loadEvalDatasets: () => datasets,
    },
  });

  mock.module("@/lib/ai/evals/live-runner", {
    namedExports: {
      runEvaluation: async (
        selectedDatasets: Array<{ feature: string }>,
        options: { live?: boolean },
      ) => {
        runEvaluationCalls.push({ datasetCount: selectedDatasets.length, live: Boolean(options.live) });
        return { ...evaluationReport, mode: options.live ? "live" : "offline" };
      },
    },
  });

  mock.module("@/lib/ai/evals/report", {
    namedExports: {
      collectFailures: () => reportFailures,
    },
  });

  mock.module("@/lib/ai/evals/registry", {
    namedExports: {
      EVALUABLE_FEATURES: ["quiz", "difficulty"],
    },
  });

  mock.module("@/lib/ai", {
    namedExports: {
      isAiConfigured: () => aiConfigured,
    },
  });
});

beforeEach(() => {
  datasets = [{ feature: "quiz" }, { feature: "difficulty" }];
  aiConfigured = true;
  reportFailures = [];
  runEvaluationCalls = [];
  writtenFiles = [];
  evaluationReport = structuredClone(baseReport);
});

test("eval script parses flags and prints help", async () => {
  const { parseArgs, main } = await import("../scripts/eval");
  const parsed = parseArgs(["--live", "--json", "--feature", "quiz", "--out", "report.json"]);
  assert.deepEqual(parsed, {
    live: true,
    json: true,
    feature: "quiz",
    out: "report.json",
    help: false,
  });

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = ((...args: unknown[]) => warnings.push(args.join(" "))) as typeof console.warn;
  parseArgs(["--unknown-flag"]);
  console.warn = originalWarn;
  assert.match(warnings.join("\n"), /Unknown flag: --unknown-flag/);

  const originalArgv = process.argv;
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = ((...args: unknown[]) => logs.push(args.join(" "))) as typeof console.log;
  process.argv = [process.execPath, "scripts/eval.ts", "--help"];
  try {
    const code = await main();
    assert.equal(code, 0);
    assert.match(logs.join("\n"), /AI evaluation harness/);
    assert.match(logs.join("\n"), /quiz, difficulty/);
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
  }
});

test("eval script validates feature and live credentials", async () => {
  const { main } = await import("../scripts/eval");

  const originalArgv = process.argv;
  const originalError = console.error;
  const errors: string[] = [];
  console.error = ((...args: unknown[]) => errors.push(args.join(" "))) as typeof console.error;

  try {
    process.argv = [process.execPath, "scripts/eval.ts", "--feature", "missing"];
    let code = await main();
    assert.equal(code, 2);
    assert.match(errors.join("\n"), /No dataset found/);

    errors.length = 0;
    aiConfigured = false;
    process.argv = [process.execPath, "scripts/eval.ts", "--live"];
    code = await main();
    assert.equal(code, 2);
    assert.match(errors.join("\n"), /--live requires AI provider credentials/);
  } finally {
    process.argv = originalArgv;
    console.error = originalError;
  }
});

test("eval script writes report output, supports json mode, and returns failure exit codes", async () => {
  const { main } = await import("../scripts/eval");

  reportFailures = [{ feature: "quiz", caseName: "case-1", property: "shape" }];

  const originalArgv = process.argv;
  const originalLog = console.log;
  const originalError = console.error;
  const logs: string[] = [];
  const errors: string[] = [];
  console.log = ((...args: unknown[]) => logs.push(args.join(" "))) as typeof console.log;
  console.error = ((...args: unknown[]) => errors.push(args.join(" "))) as typeof console.error;

  try {
    process.argv = [
      process.execPath,
      "scripts/eval.ts",
      "--feature",
      "quiz",
      "--json",
      "--out",
      "eval-report.json",
      "--live",
    ];

    const code = await main();
    assert.equal(code, 1);
    assert.deepEqual(runEvaluationCalls, [{ datasetCount: 1, live: true }]);
    assert.equal(writtenFiles.length, 1);
    assert.equal(writtenFiles[0]?.path, "eval-report.json");
    assert.match(logs.join("\n"), /"mode": "live"/);
    assert.match(errors.join("\n"), /Wrote report to eval-report.json/);
    assert.match(errors.join("\n"), /1 property check\(s\) failed/);
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
    console.error = originalError;
  }
});

test("eval script prints human-readable report and succeeds with no failures", async () => {
  const { main } = await import("../scripts/eval");
  evaluationReport = {
    ...baseReport,
    features: [
      {
        ...baseReport.features[0],
        cases: [
          {
            ...baseReport.features[0]!.cases[0]!,
            passed: false,
            properties: [{ name: "shape", passed: false, detail: "missing field" }],
          },
        ],
      },
    ],
  };

  const originalArgv = process.argv;
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = ((...args: unknown[]) => logs.push(args.join(" "))) as typeof console.log;

  try {
    process.argv = [process.execPath, "scripts/eval.ts"];
    const code = await main();
    assert.equal(code, 0);
    assert.deepEqual(runEvaluationCalls, [{ datasetCount: 2, live: false }]);
    assert.match(logs.join("\n"), /AI evaluation report \(offline\)/);
    assert.match(logs.join("\n"), /TOTAL  cases 1\/1/);
    assert.match(logs.join("\n"), /✗ shape: missing field/);
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
  }
});

test("eval script entrypoint executes runScript when module is main", async () => {
  const scriptUrl = new URL("../scripts/eval.ts", import.meta.url).href;
  const scriptPath = fileURLToPath(scriptUrl);
  const originalArgv = process.argv;
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const exits: Array<number | undefined> = [];

  let resolveExit: (() => void) | null = null;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  process.argv = [process.execPath, scriptPath, "--help"];
  process.exit = ((code?: string | number | null | undefined): never => {
    exits.push(typeof code === "number" ? code : code == null ? 0 : Number(code));
    resolveExit?.();
    return undefined as never;
  }) as typeof process.exit;
  console.log = (() => undefined) as typeof console.log;
  console.warn = (() => undefined) as typeof console.warn;
  console.error = (() => undefined) as typeof console.error;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { runAsCli } = await import("../scripts/eval");
    runAsCli(scriptUrl);
    await Promise.race([
      exited,
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new Error("eval entrypoint did not exit")), 1000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    process.argv = originalArgv;
    process.exit = originalExit;
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.deepEqual(exits, [0]);
});
