import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

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
};

function parsePercent(value: string): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  return Number(value);
}

export function parseNodeCoverageText(text: string): CoverageRow[] {
  const rows: CoverageRow[] = [];
  const dirs: Array<{ depth: number; name: string }> = [];

  for (const line of text.split(/\r?\n/)) {
    const info = /^(?:ℹ|#) ?(.*)$/.exec(line);
    if (!info) continue;

    const content = info[1];
    const firstPipe = content.indexOf("|");
    if (firstPipe === -1) continue;

    const nameField = content.slice(0, firstPipe);
    const columns = content
      .slice(firstPipe + 1)
      .split("|")
      .map((part) => part.trim());
    if (columns.length < 4) continue;

    const rawName = nameField.trim();
    if (
      rawName.length === 0 ||
      rawName === "file" ||
      rawName === "all files" ||
      /^-+$/.test(rawName)
    ) {
      continue;
    }

    const depth = nameField.match(/^\s*/)?.[0].length ?? 0;
    const linePct = parsePercent(columns[0]);
    if (linePct === null) {
      if (columns.every((part) => part === "")) {
        while (dirs.length > 0 && dirs[dirs.length - 1].depth >= depth) dirs.pop();
        dirs.push({ depth, name: rawName });
      }
      continue;
    }

    const parentDirs = dirs
      .filter((dir) => dir.depth < depth)
      .map((dir) => dir.name);
    const file = [...parentDirs, rawName].join("/");
    rows.push({
      file,
      linePct,
      uncoveredLines: columns[3] ?? "",
    });
  }

  return rows;
}

export function coverageFailures(
  rows: CoverageRow[],
  threshold = DEFAULT_THRESHOLD,
  includePrefixes = DEFAULT_INCLUDE_PREFIXES,
): CoverageFailure[] {
  return rows
    .filter((row) => includePrefixes.some((prefix) => row.file.startsWith(prefix)))
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
  const nodeArgs = [
    "--env-file-if-exists=.env",
    "--experimental-strip-types",
    "--import",
    "./scripts/register-ts.mjs",
    "--no-warnings",
    "--experimental-test-module-mocks",
    "--experimental-test-coverage",
    ...(testArgs.length > 0 ? testArgs : DEFAULT_TEST_ARGS),
  ];
  const result = (deps.spawnSync ?? (spawnSync as NativeCoverageSpawn))(
    deps.execPath ?? process.execPath,
    nodeArgs,
    {
      cwd: deps.cwd ?? process.cwd(),
      env,
      encoding: "utf8",
      maxBuffer: 100 * 1024 * 1024,
    },
  );

  if (showReport) {
    if (result.stdout) (deps.stdout ?? process.stdout).write(result.stdout);
    if (result.stderr) (deps.stderr ?? process.stderr).write(result.stderr);
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
  const measured = rows.filter((row) =>
    includePrefixes.some((prefix) => row.file.startsWith(prefix)),
  );
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
    return failures.length === 0 ? 0 : 1;
  } catch (err) {
    output.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

function main(): void {
  process.exit(runCoverageGate(process.argv.slice(2)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
