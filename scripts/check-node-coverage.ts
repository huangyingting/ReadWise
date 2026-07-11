import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildRouteInventory,
  discoverEligibleFiles,
  discoverRoutes,
  mergeWithCoverage,
  normalizePath,
  parseCoverageDebt,
  type CoverageDebtConfig,
  type DiscoveryResult,
  type RouteInventoryResult,
  type StaticDenominatorResult,
} from "./coverage-static-discovery";

export type CoverageRow = {
  file: string;
  linePct: number;
  uncoveredLines: string;
};

export type CoverageFailure = CoverageRow & {
  threshold: number;
};

export type CliOptions = {
  threshold: number;
  includePrefixes: string[];
  inputFile: string | null;
  inputFromStdin: boolean;
  showReport: boolean;
  skipStatic: boolean;
  testArgs: string[];
};

const DEFAULT_THRESHOLD = 98;
export const DEFAULT_INCLUDE_PREFIXES = ["src/", "scripts/", "eslint-rules/"];
const DEFAULT_TEST_ARGS = ["--test", "tests/**/*.test.ts"];

type CoverageInputFs = {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string | number, encoding: BufferEncoding) => string;
};

type NativeCoverageResult = {
  stdout?: string | null;
  stderr?: string | null;
  status?: number | null;
};

type NativeCoverageSpawn = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string | undefined>;
    encoding: "utf8";
    maxBuffer: number;
  },
) => NativeCoverageResult;

type NativeCoverageDeps = {
  spawnSync?: NativeCoverageSpawn;
  stdout?: { write: (chunk: string) => unknown };
  stderr?: { write: (chunk: string) => unknown };
  cwd?: string;
  env?: Record<string, string | undefined>;
  execPath?: string;
};

type CoverageOutput = {
  log: (message: string) => void;
  error: (message: string) => void;
};

type StaticDenominatorDeps = {
  rootDir?: string;
  debtFile?: string;
  today?: string;
  skipStatic?: boolean;
};

type CoverageGateDeps = {
  readCoverageInput?: (
    inputFile: string | null,
    inputFromStdin: boolean,
  ) => string | null;
  runNativeCoverage?: (
    testArgs: string[],
    showReport: boolean,
  ) => { text: string; status: number };
  output?: CoverageOutput;
  static?: StaticDenominatorDeps;
};

type ParsedCoverageLine = {
  nameField: string;
  rawName: string;
  columns: string[];
  depth: number;
  linePct: number | null;
};

type CoverageDirectory = {
  depth: number;
  name: string;
};

function parsePercent(value: string): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  return Number(value);
}

function parseCoverageLine(line: string): ParsedCoverageLine | null {
  const info = /^(?:ℹ|#) ?(.*)$/.exec(line);
  if (!info) return null;

  const content = info[1];
  const firstPipe = content.indexOf("|");
  if (firstPipe === -1) return null;

  const nameField = content.slice(0, firstPipe);
  const columns = content
    .slice(firstPipe + 1)
    .split("|")
    .map((part) => part.trim());
  if (columns.length < 4) return null;

  const rawName = nameField.trim();
  return {
    nameField,
    rawName,
    columns,
    depth: nameField.match(/^\s*/)?.[0].length ?? 0,
    linePct: parsePercent(columns[0]),
  };
}

function isCoverageMetadataRow(rawName: string): boolean {
  return (
    rawName.length === 0 ||
    rawName === "file" ||
    rawName === "all files" ||
    /^-+$/.test(rawName)
  );
}

function pushDirectoryRow(
  dirs: CoverageDirectory[],
  depth: number,
  name: string,
): void {
  while (dirs.length > 0 && dirs[dirs.length - 1].depth >= depth) dirs.pop();
  dirs.push({ depth, name });
}

function filePathForCoverageRow(
  dirs: CoverageDirectory[],
  depth: number,
  rawName: string,
): string {
  const parentDirs = dirs
    .filter((dir) => dir.depth < depth)
    .map((dir) => dir.name);
  return [...parentDirs, rawName].join("/");
}

export function parseNodeCoverageText(text: string): CoverageRow[] {
  const rows: CoverageRow[] = [];
  const dirs: CoverageDirectory[] = [];

  for (const line of text.split(/\r?\n/)) {
    const parsed = parseCoverageLine(line);
    if (!parsed) continue;

    const { rawName, columns, depth, linePct } = parsed;
    if (isCoverageMetadataRow(rawName)) continue;

    if (linePct === null) {
      if (columns.every((part) => part === "")) {
        pushDirectoryRow(dirs, depth, rawName);
      }
      continue;
    }

    rows.push({
      file: filePathForCoverageRow(dirs, depth, rawName),
      linePct,
      uncoveredLines: columns[3] ?? "",
    });
  }

  return rows;
}

function isIncludedCoverageRow(row: CoverageRow, includePrefixes: string[]): boolean {
  return includePrefixes.some((prefix) => row.file.startsWith(prefix));
}

export function coverageFailures(
  rows: CoverageRow[],
  threshold = DEFAULT_THRESHOLD,
  includePrefixes = DEFAULT_INCLUDE_PREFIXES,
): CoverageFailure[] {
  return rows
    .filter((row) => isIncludedCoverageRow(row, includePrefixes))
    .filter((row) => row.linePct < threshold)
    .map((row) => ({ ...row, threshold }))
    .sort((a, b) => a.linePct - b.linePct || a.file.localeCompare(b.file));
}

export function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    threshold: DEFAULT_THRESHOLD,
    includePrefixes: [...DEFAULT_INCLUDE_PREFIXES],
    inputFile: null,
    inputFromStdin: false,
    showReport: true,
    skipStatic: false,
    testArgs: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      opts.testArgs.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "--threshold") {
      opts.threshold = Number(argv[++i]);
      continue;
    }
    if (arg.startsWith("--threshold=")) {
      opts.threshold = Number(arg.slice("--threshold=".length));
      continue;
    }
    if (arg === "--include") {
      opts.includePrefixes.push(argv[++i]);
      continue;
    }
    if (arg.startsWith("--include=")) {
      opts.includePrefixes.push(arg.slice("--include=".length));
      continue;
    }
    if (arg === "--only-include") {
      opts.includePrefixes = [argv[++i]];
      continue;
    }
    if (arg.startsWith("--only-include=")) {
      opts.includePrefixes = [arg.slice("--only-include=".length)];
      continue;
    }
    if (arg === "--input") {
      opts.inputFile = argv[++i];
      continue;
    }
    if (arg.startsWith("--input=")) {
      opts.inputFile = arg.slice("--input=".length);
      continue;
    }
    if (arg === "--stdin") {
      opts.inputFromStdin = true;
      continue;
    }
    if (arg === "--summary-only" || arg === "--quiet") {
      opts.showReport = false;
      continue;
    }
    if (arg === "--skip-static") {
      opts.skipStatic = true;
      continue;
    }
    opts.testArgs.push(arg);
  }

  if (!Number.isFinite(opts.threshold) || opts.threshold < 0 || opts.threshold > 100) {
    throw new Error("--threshold must be a number from 0 to 100");
  }
  if (opts.includePrefixes.length === 0 || opts.includePrefixes.some((p) => !p)) {
    throw new Error("at least one non-empty --include prefix is required");
  }
  return opts;
}

function nativeCoverageNodeArgs(testArgs: string[]): string[] {
  return [
    "--env-file-if-exists=.env",
    "--experimental-strip-types",
    "--import",
    "./scripts/register-ts.mjs",
    "--no-warnings",
    "--experimental-test-module-mocks",
    "--experimental-test-coverage",
    ...(testArgs.length > 0 ? testArgs : DEFAULT_TEST_ARGS),
  ];
}

function writeIfPresent(
  stream: { write: (chunk: string) => unknown },
  chunk?: string | null,
): void {
  if (chunk) stream.write(chunk);
}

export function readCoverageInput(
  inputFile: string | null,
  inputFromStdin: boolean,
  fs: CoverageInputFs = {
    existsSync,
    readFileSync: readFileSync as CoverageInputFs["readFileSync"],
  },
): string | null {
  if (inputFile) {
    if (!fs.existsSync(inputFile)) throw new Error(`coverage input not found: ${inputFile}`);
    return fs.readFileSync(inputFile, "utf8");
  }

  if (inputFromStdin) {
    return fs.readFileSync(0, "utf8");
  }

  return null;
}

export function runNativeCoverage(
  testArgs: string[],
  showReport: boolean,
  deps: NativeCoverageDeps = {},
): { text: string; status: number } {
  const env: Record<string, string | undefined> = {
    ...(deps.env ?? process.env),
    NODE_ENV: "test",
  };
  delete env.NODE_TEST_CONTEXT;
  const result = (deps.spawnSync ?? (spawnSync as NativeCoverageSpawn))(
    deps.execPath ?? process.execPath,
    nativeCoverageNodeArgs(testArgs),
    {
      cwd: deps.cwd ?? process.cwd(),
      env,
      encoding: "utf8",
      maxBuffer: 100 * 1024 * 1024,
    },
  );

  if (showReport) {
    writeIfPresent(deps.stdout ?? process.stdout, result.stdout);
    writeIfPresent(deps.stderr ?? process.stderr, result.stderr);
  }

  return {
    text: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    status: result.status ?? 1,
  };
}

export function printGateResult(
  rows: CoverageRow[],
  failures: CoverageFailure[],
  threshold: number,
  includePrefixes: string[],
  output: CoverageOutput = console,
): void {
  const measured = rows.filter((row) => isIncludedCoverageRow(row, includePrefixes));
  if (failures.length === 0) {
    output.log(
      `Coverage gate passed: ${measured.length} measured file(s) at line coverage >= ${threshold}%.`,
    );
    return;
  }

  output.error(
    `Coverage gate failed: ${failures.length} measured file(s) below ${threshold}% line coverage:`,
  );
  for (const failure of failures) {
    const uncovered = failure.uncoveredLines ? ` uncovered=${failure.uncoveredLines}` : "";
    output.error(`- ${failure.linePct.toFixed(2)}% ${failure.file}${uncovered}`);
  }
}

export function runCoverageGate(argv: string[], deps: CoverageGateDeps = {}): number {
  const output = deps.output ?? console;
  try {
    const opts = parseCliArgs(argv);
    const input = (deps.readCoverageInput ?? readCoverageInput)(
      opts.inputFile,
      opts.inputFromStdin,
    );
    const run =
      input === null
        ? (deps.runNativeCoverage ?? runNativeCoverage)(opts.testArgs, opts.showReport)
        : { text: input, status: 0 };
    const rows = parseNodeCoverageText(run.text);
    if (rows.length === 0) {
      output.error("Coverage gate failed: no native Node coverage table was found.");
      return run.status || 1;
    }

    const failures = coverageFailures(rows, opts.threshold, opts.includePrefixes);
    printGateResult(rows, failures, opts.threshold, opts.includePrefixes, output);

    if (run.status !== 0) return run.status;
    if (failures.length > 0) return 1;

    // Static denominator integration
    const staticDeps = deps.static ?? {};
    if (staticDeps.skipStatic || opts.skipStatic) return 0;

    const rootDir = staticDeps.rootDir ?? process.cwd();
    const debtFile = staticDeps.debtFile ?? resolve(rootDir, "coverage-debt.json");
    const today = staticDeps.today ?? new Date().toISOString().slice(0, 10);

    const staticResult = runStaticDenominator(
      rootDir,
      debtFile,
      today,
      rows,
      opts.threshold,
      opts.includePrefixes,
      output,
    );

    return staticResult;
  } catch (err) {
    output.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

function runStaticDenominator(
  rootDir: string,
  debtFile: string,
  today: string,
  rows: CoverageRow[],
  threshold: number,
  includePrefixes: string[],
  output: CoverageOutput,
): number {
  // Discover eligible files
  const discovery = discoverEligibleFiles(rootDir);

  // Load debt config
  if (!existsSync(debtFile)) {
    output.error(`Static denominator: coverage-debt.json not found at ${debtFile}`);
    return 1;
  }
  const debtContent = readFileSync(debtFile, "utf8");

  // Discover routes for validation
  const allRoutes = discoverRoutes(rootDir);
  const existingFileSet = new Set(discovery.eligible);
  const existingRouteSet = new Set(allRoutes);

  const debt = parseCoverageDebt(debtContent, today, existingFileSet, existingRouteSet);

  // Get measured file set from coverage rows
  const measuredFiles = new Set(
    rows
      .filter((row) => includePrefixes.some((p) => row.file.startsWith(p)))
      .map((row) => row.file),
  );

  // Merge discovery with coverage
  const debtFileSet = new Set(debt.fileDebt.map((d) => d.file));
  const { syntheticZeroFiles, debtExcusedFiles } = mergeWithCoverage(
    discovery.eligible,
    measuredFiles,
    debtFileSet,
  );

  // Build route inventory
  const routeDebtSet = new Set(debt.routeDebt.map((d) => d.route));
  const coveredRoutesInTests = new Set(
    rows.filter((row) => row.file.startsWith("src/app/api/")).map((row) => row.file),
  );
  const routeInventory = buildRouteInventory(allRoutes, coveredRoutesInTests, debt.routeDebt);

  // Print summary
  output.log(`\nStatic denominator summary:`);
  output.log(`  Eligible executable files: ${discovery.eligible.length}`);
  output.log(`  Excluded (type-only): ${discovery.excluded.filter((e) => e.reason === "type-only").length}`);
  output.log(`  Excluded (pure-barrel): ${discovery.excluded.filter((e) => e.reason === "pure-barrel").length}`);
  output.log(`  Excluded (client-only): ${discovery.excluded.filter((e) => e.reason === "client-only").length}`);
  output.log(`  Measured by tests: ${measuredFiles.size}`);
  output.log(`  Debt-excused files: ${debtExcusedFiles.length}/${debt.maxFileDebt} max`);
  output.log(`  Synthetic 0% (unimported, no debt): ${syntheticZeroFiles.length}`);
  output.log(`\nRoute inventory:`);
  output.log(`  Total routes: ${routeInventory.allRoutes.length}`);
  output.log(`  Covered by tests: ${routeInventory.coveredRoutes.length}`);
  output.log(`  Debt-excused routes: ${routeInventory.debtRoutes.length}/${debt.maxRouteDebt} max`);
  output.log(`  Uncovered routes (no debt): ${routeInventory.uncoveredRoutes.length}`);

  // Fail if there are unimported files with no debt
  let failed = false;
  if (syntheticZeroFiles.length > 0) {
    output.error(
      `\nStatic denominator failed: ${syntheticZeroFiles.length} eligible file(s) have 0% coverage with no debt entry:`,
    );
    for (const file of syntheticZeroFiles) {
      output.error(`- 0.00% ${file} (synthetic — not loaded by tests)`);
    }
    failed = true;
  }

  // Fail if there are uncovered routes with no debt
  if (routeInventory.uncoveredRoutes.length > 0) {
    output.error(
      `\nRoute inventory failed: ${routeInventory.uncoveredRoutes.length} route(s) have no test coverage and no debt entry:`,
    );
    for (const route of routeInventory.uncoveredRoutes) {
      output.error(`- ${route}`);
    }
    failed = true;
  }

  return failed ? 1 : 0;
}

function main(): void {
  process.exit(runCoverageGate(process.argv.slice(2)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
