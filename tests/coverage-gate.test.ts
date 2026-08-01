import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_INCLUDE_PREFIXES,
  coverageFailures,
  mergeCoverageRows,
  parseCliArgs,
  parseNodeCoverageText,
  readCoverageInputs,
  runCoverageGate,
  runNativeCoverage,
} from "../scripts/check-node-coverage";

function coverageReport(lines: string[]): string {
  return lines.join("\n");
}

function parseCoverageRows(lines: string[]) {
  return parseNodeCoverageText(coverageReport(lines));
}

const PASSING_REPORT = coverageReport([
  "ℹ start of coverage report",
  "ℹ ---------------------------------------------------------------",
  "ℹ file                  | line % | branch % | funcs % | uncovered lines",
  "ℹ ---------------------------------------------------------------",
  "ℹ src                   |        |          |         | ",
  "ℹ  lib                  |        |          |         | ",
  "ℹ   ok.ts               | 100.00 |   100.00 |  100.00 | ",
  "ℹ scripts               |        |          |         | ",
  "ℹ  check-node-coverage.ts |  99.00 |   100.00 |  100.00 | ",
  "ℹ eslint-rules          |        |          |         | ",
  "ℹ  ui-design-system.js  |  98.00 |   100.00 |  100.00 | ",
  "ℹ all files             |  99.00 |   100.00 |  100.00 | ",
  "ℹ end of coverage report",
]);

const FAILING_REPORT = coverageReport([
  "ℹ file                  | line % | branch % | funcs % | uncovered lines",
  "ℹ scripts               |        |          |         | ",
  "ℹ  check-node-coverage.ts |  97.00 |   100.00 |  100.00 | 10-12",
  "ℹ  lib                  |        |          |         | ",
  "ℹ   cli.ts              |  96.00 |   100.00 |  100.00 | 30",
  "ℹ eslint-rules          |        |          |         | ",
  "ℹ  ui-design-system.js  | 100.00 |   100.00 |  100.00 | ",
  "ℹ tests                 |        |          |         | ",
  "ℹ  helper.test.ts       |  10.00 |   100.00 |  100.00 | 1-9",
]);

function captureOutput() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    output: {
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
    },
  };
}

test("coverage gate parses native Node coverage tree rows and failing files", () => {
  const rows = parseCoverageRows([
    "ℹ start of coverage report",
    "ℹ ---------------------------------------------------------------",
    "ℹ file                  | line % | branch % | funcs % | uncovered lines",
    "ℹ ---------------------------------------------------------------",
    "ℹ src                   |        |          |         | ",
    "ℹ  lib                  |        |          |         | ",
    "ℹ   cache.ts            |  97.50 |   100.00 |  100.00 | 81-82",
    "ℹ   search              |        |          |         | ",
    "ℹ    providers.ts       | 100.00 |   100.00 |  100.00 | ",
    "ℹ tests                 |        |          |         | ",
    "ℹ  helper.test.ts       |  10.00 |   100.00 |  100.00 | 1-9",
    "ℹ all files             |  99.00 |   100.00 |  100.00 | ",
    "ℹ end of coverage report",
  ]);
  assert.deepEqual(rows.map((row) => row.file), [
    "src/lib/cache.ts",
    "src/lib/search/providers.ts",
    "tests/helper.test.ts",
  ]);

  assert.deepEqual(
    coverageFailures(rows, 98).map((row) => ({
      file: row.file,
      linePct: row.linePct,
      uncoveredLines: row.uncoveredLines,
    })),
    [{ file: "src/lib/cache.ts", linePct: 97.5, uncoveredLines: "81-82" }],
  );
});

test("coverage gate defaults to every measured code-file prefix", () => {
  const rows = parseCoverageRows([
    "ℹ file                  | line % | branch % | funcs % | uncovered lines",
    "ℹ scripts               |        |          |         | ",
    "ℹ  check-node-coverage.ts |  97.99 |   100.00 |  100.00 | 42",
    "ℹ eslint-rules          |        |          |         | ",
    "ℹ  ui-design-system.js  |  97.98 |   100.00 |  100.00 | 12",
  ]);

  assert.deepEqual(DEFAULT_INCLUDE_PREFIXES, ["src/", "scripts/", "eslint-rules/"]);
  assert.deepEqual(coverageFailures(rows, 98).map((row) => row.file), [
    "eslint-rules/ui-design-system.js",
    "scripts/check-node-coverage.ts",
  ]);
});

test("coverage gate parses CLI options in space and equals forms", () => {
  assert.deepEqual(parseCliArgs([]).includePrefixes, DEFAULT_INCLUDE_PREFIXES);

  assert.deepEqual(parseCliArgs([
    "--threshold",
    "97.5",
    "--include",
    "scripts/",
    "--input",
    "report.txt",
    "--stdin",
    "--summary-only",
    "--",
    "--test",
    "tests/coverage-gate.test.ts",
  ]), {
    threshold: 97.5,
    includePrefixes: ["src/", "scripts/", "eslint-rules/", "scripts/"],
    inputFiles: ["report.txt"],
    inputFromStdin: true,
    showReport: false,
   skipStatic: false,
   testArgs: ["--test", "tests/coverage-gate.test.ts"],
  });

  assert.deepEqual(parseCliArgs([
   "--threshold=99",
   "--only-include=eslint-rules/",
   "--include=src/",
   "--input=report.txt",
   "--quiet",
   "tests/native.fixture.ts",
  ]), {
   threshold: 99,
   includePrefixes: ["eslint-rules/", "src/"],
   inputFiles: ["report.txt"],
   inputFromStdin: false,
   showReport: false,
   skipStatic: false,
   testArgs: ["tests/native.fixture.ts"],
  });

  assert.deepEqual(parseCliArgs(["--only-include", "scripts/lib/cli.ts"]).includePrefixes, [
    "scripts/lib/cli.ts",
  ]);

  assert.deepEqual(
    parseCliArgs(["--input", "postgres.txt", "--input=sqlite.txt"]).inputFiles,
    ["postgres.txt", "sqlite.txt"],
  );
});

test("coverage gate rejects invalid thresholds and include prefixes", () => {
  assert.throws(() => parseCliArgs(["--threshold", "101"]), /threshold/);
  assert.throws(() => parseCliArgs(["--threshold=nan"]), /threshold/);
  assert.throws(() => parseCliArgs(["--only-include="]), /include prefix/);
  assert.throws(() => parseCliArgs(["--include"]), /include prefix/);
});

test("coverage gate reads repeated input files and stdin", () => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/coverage-gate/native-report.txt", import.meta.url),
  );
  const fixtureText = readCoverageInputs([fixturePath], false)?.[0] ?? "";
  assert.deepEqual(parseNodeCoverageText(fixtureText).map((row) => row.file), [
    "src/lib/fixture.ts",
  ]);
  assert.equal(readCoverageInputs([], false), null);
  assert.throws(
    () => readCoverageInputs(["tests/fixtures/coverage-gate/missing-report.txt"], false),
    /coverage input not found/,
  );

  const stdin = readCoverageInputs([], true, {
    existsSync: () => false,
    readFileSync: (path, encoding) => {
      assert.equal(path, 0);
      assert.equal(encoding, "utf8");
      return PASSING_REPORT;
    },
  });
  assert.deepEqual(stdin, [PASSING_REPORT]);
});

test("coverage gate merges complete provider reports without combining partial lines", () => {
  const postgresRows = parseCoverageRows([
    "ℹ file                  | line % | branch % | funcs % | uncovered lines",
    "ℹ src                   |        |          |         | ",
    "ℹ  lib                  |        |          |         | ",
    "ℹ   shared.ts           |  97.00 |   90.00 |   90.00 | 10-12",
    "ℹ   postgres-only.ts    | 100.00 |  100.00 |  100.00 | ",
  ]);
  const sqliteRows = parseCoverageRows([
    "ℹ file                  | line % | branch % | funcs % | uncovered lines",
    "ℹ src                   |        |          |         | ",
    "ℹ  lib                  |        |          |         | ",
    "ℹ   shared.ts           |  99.00 |   70.00 |   80.00 | 20",
    "ℹ   sqlite-only.ts      | 100.00 |  100.00 |  100.00 | ",
  ]);

  assert.deepEqual(mergeCoverageRows([postgresRows, sqliteRows]), [
    { file: "src/lib/postgres-only.ts", linePct: 100, uncoveredLines: "" },
    { file: "src/lib/shared.ts", linePct: 99, uncoveredLines: "20" },
    { file: "src/lib/sqlite-only.ts", linePct: 100, uncoveredLines: "" },
  ]);
});

test("coverage gate accepts repeated reports only when their merged rows pass", () => {
  const { logs, errors, output } = captureOutput();
  let requestedFiles: string[] = [];
  const sqliteReport = PASSING_REPORT.replace(
    "99.00 |   100.00 |  100.00",
    "97.00 |   100.00 |  100.00",
  );

  const code = runCoverageGate([
    "--input",
    "postgres.txt",
    "--input=sqlite.txt",
    "--threshold=98",
    "--skip-static",
  ], {
    readCoverageInputs: (inputFiles) => {
      requestedFiles = inputFiles;
      return [sqliteReport, PASSING_REPORT];
    },
    output,
  });

  assert.equal(code, 0);
  assert.deepEqual(requestedFiles, ["postgres.txt", "sqlite.txt"]);
  assert.deepEqual(errors, []);
  assert.match(logs[0] ?? "", /Coverage gate passed/);
});

test("coverage gate fails when include filters match zero measured files", () => {
  const { errors, output } = captureOutput();
  const code = runCoverageGate([
    "--stdin",
    "--only-include=src/lib/not-loaded.ts",
    "--skip-static",
  ], {
    readCoverageInputs: () => [PASSING_REPORT],
    output,
  });

  assert.equal(code, 1);
  assert.match(errors.join("\n"), /no measured files matched/i);
});

test("coverage gate succeeds for parsed input coverage", () => {
  const { logs, errors, output } = captureOutput();

  const code = runCoverageGate(["--stdin", "--threshold", "98", "--skip-static"], {
    readCoverageInputs: () => [PASSING_REPORT],
    output,
  });

  assert.equal(code, 0);
  assert.deepEqual(errors, []);
  assert.match(logs[0] ?? "", /Coverage gate passed: 3 measured file\(s\)/);
});

test("coverage gate fails and prints uncovered lines for low coverage", () => {
  const { logs, errors, output } = captureOutput();

  const code = runCoverageGate([
    "--stdin",
    "--threshold=98",
    "--only-include=scripts/",
    "--include=eslint-rules/",
  ], {
    readCoverageInputs: () => [FAILING_REPORT],
    output,
  });

  assert.equal(code, 1);
  assert.deepEqual(logs, []);
  assert.match(errors[0] ?? "", /2 measured file\(s\) below 98%/);
  assert.match(errors.join("\n"), /97\.00% scripts\/check-node-coverage\.ts uncovered=10-12/);
  assert.match(errors.join("\n"), /96\.00% scripts\/lib\/cli\.ts uncovered=30/);
  assert.doesNotMatch(errors.join("\n"), /helper\.test\.ts/);
});

test("coverage gate reports no-table and preserves failing native status", () => {
  const noTable = captureOutput();
  assert.equal(
    runCoverageGate(["--skip-static"], {
      runNativeCoverage: () => ({ text: "TAP without coverage", status: 7 }),
      output: noTable.output,
    }),
    7,
  );
  assert.match(noTable.errors[0] ?? "", /no native Node coverage table/);

  const nativeFailure = captureOutput();
  assert.equal(
    runCoverageGate(["--skip-static"], {
      runNativeCoverage: () => ({ text: PASSING_REPORT, status: 5 }),
      output: nativeFailure.output,
    }),
    5,
  );
  assert.match(nativeFailure.logs[0] ?? "", /Coverage gate passed/);
});

test("coverage gate returns parse errors without throwing", () => {
  const { errors, output } = captureOutput();
  assert.equal(runCoverageGate(["--threshold=wat"], { output }), 1);
  assert.deepEqual(errors, ["--threshold must be a number from 0 to 100"]);
});

test("runNativeCoverage writes reports and normalizes missing native status", () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const result = runNativeCoverage(["--test", "tests/native.fixture.ts"], true, {
    execPath: "node-custom",
    cwd: "/repo",
    env: { READWISE_TEST: "1" },
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
    spawnSync: (command, args, options) => {
      assert.equal(command, "node-custom");
      assert.ok(args.includes("--experimental-test-coverage"));
      assert.deepEqual(args.slice(-2), ["--test", "tests/native.fixture.ts"]);
      assert.equal(options.cwd, "/repo");
      assert.equal(options.env.READWISE_TEST, "1");
      assert.equal(options.env.NODE_ENV, "test");
      assert.equal(options.encoding, "utf8");
      assert.equal(options.maxBuffer, 100 * 1024 * 1024);
      return { stdout: "native stdout", stderr: "native stderr", status: null };
    },
  });

  assert.deepEqual(result, { text: "native stdout\nnative stderr", status: 1 });
  assert.deepEqual(stdout, ["native stdout"]);
  assert.deepEqual(stderr, ["native stderr"]);
});

test("runNativeCoverage can spawn native Node coverage for a narrow fixture", () => {
  const result = runNativeCoverage(
    ["--test", "tests/fixtures/coverage-gate/native-pass.fixture.ts"],
    false,
  );

  assert.equal(result.status, 0, result.text);
  assert.ok(
    parseNodeCoverageText(result.text).some((row) =>
      row.file.endsWith("native-pass.fixture.ts"),
    ),
    result.text,
  );
});

// ---------------------------------------------------------------------------
// Static denominator integration tests
// ---------------------------------------------------------------------------

test("coverage gate with static denominator detects synthetic 0% files", () => {
  const { logs, errors, output } = captureOutput();

  const code = runCoverageGate(["--stdin", "--threshold", "98"], {
    readCoverageInputs: () => [PASSING_REPORT],
    output,
    static: {
      rootDir: process.cwd(),
      debtFile: "coverage-debt.json",
      today: "2026-07-11",
    },
  });

  assert.equal(code, 1);
  const allOutput = [...logs, ...errors].join("\n");
  assert.match(allOutput, /Static denominator summary/);
  assert.match(allOutput, /Static denominator failed/);
  assert.match(allOutput, /synthetic/);
});

test("coverage gate static denominator reports missing debt file", () => {
  const { errors, output } = captureOutput();

  const code = runCoverageGate(["--stdin", "--threshold", "98"], {
    readCoverageInputs: () => [PASSING_REPORT],
    output,
    static: {
      rootDir: process.cwd(),
      debtFile: "nonexistent-debt.json",
      today: "2026-07-11",
    },
  });

  assert.equal(code, 1);
  assert.match(errors.join("\n"), /coverage-debt\.json not found/);
});

test("coverage gate --skip-static bypasses static denominator", () => {
  const { logs, errors, output } = captureOutput();

  const code = runCoverageGate(["--stdin", "--threshold", "98", "--skip-static"], {
    readCoverageInputs: () => [PASSING_REPORT],
    output,
  });

  assert.equal(code, 0);
  assert.doesNotMatch([...logs, ...errors].join("\n"), /Static denominator/);
});
