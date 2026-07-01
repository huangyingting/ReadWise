/**
 * Shared CLI runtime utilities for ReadWise scripts.
 *
 * Provides:
 *   - runCli / runScript: standard entrypoint wrappers with error handling
 *     and exit codes.
 *   - isMain: guard for conditional entry point execution (enables module
 *     testing without triggering side-effects).
 *   - Argument parsing helpers: parseFlag, parseString, parsePositiveInt,
 *     addUniqueFromCsv, warnUnknown.
 *   - Signal handling: registerShutdownSignals.
 */
import { fileURLToPath } from "node:url";
import { prisma } from "@/lib/prisma";

type ExitFn = (code?: number) => never;

type CliRuntimeDeps = {
  disconnect?: () => Promise<void>;
  error?: (...args: unknown[]) => void;
  exit?: ExitFn;
};

type ScriptRuntimeDeps = {
  error?: (...args: unknown[]) => void;
  exit?: ExitFn;
};

type SignalProcess = {
  on: (event: "SIGINT" | "SIGTERM", listener: () => void) => unknown;
  exit: ExitFn;
};

// ── Entry point guards ─────────────────────────────────────────────────────

/**
 * Returns true when the module at `importMetaUrl` is the CLI entry point.
 * Use this to guard `runCli(main)` / `runScript(main)` so script modules can
 * be imported in tests without triggering side-effects.
 *
 * @example
 *   if (isMain(import.meta.url)) runCli(main);
 */
export function isMain(importMetaUrl: string): boolean {
  try {
    return fileURLToPath(importMetaUrl) === process.argv[1];
  } catch {
    return false;
  }
}

// ── Entrypoint wrappers ────────────────────────────────────────────────────

/**
 * Runs a CLI main function that returns an exit code.
 * Disconnects Prisma and exits with the returned code on success,
 * or exits with code 1 after printing the error on failure.
 */
export function runCli(main: () => Promise<number>, deps: CliRuntimeDeps = {}): void {
  const disconnect = deps.disconnect ?? (() => prisma.$disconnect());
  const error = deps.error ?? console.error;
  const exit = deps.exit ?? process.exit;

  main()
    .then(async (code) => {
      await disconnect();
      exit(code);
    })
    .catch(async (err: unknown) => {
      error(err);
      await disconnect();
      exit(1);
    });
}

/**
 * Runs a CLI main function that does not use Prisma directly.
 * Exits with the returned code (or 0 if none is returned),
 * or exits with code 1 after printing the error on failure.
 *
 * @param label  Optional prefix for error messages, e.g. `"eval failed"`.
 */
export function runScript(
  main: () => Promise<number | void>,
  label?: string,
  deps: ScriptRuntimeDeps = {},
): void {
  const error = deps.error ?? console.error;
  const exit = deps.exit ?? process.exit;

  main()
    .then((code) => {
      exit(typeof code === "number" ? code : 0);
    })
    .catch((err: unknown) => {
      if (label) {
        error(`${label}:`, err);
      } else {
        error(err);
      }
      exit(1);
    });
}

// ── Argument parsing helpers ───────────────────────────────────────────────

/**
 * Returns true if `argv` contains any of the given flag names.
 *
 * @example parseFlag(argv, "--dry-run")
 * @example parseFlag(argv, "--help", "-h")
 */
export function parseFlag(argv: string[], ...flags: string[]): boolean {
  return argv.some((a) => flags.includes(a));
}

/**
 * Returns the value immediately following `flag` in `argv`, or `null` if the
 * flag is absent or is the last argument.
 *
 * @example parseString(["--out", "report.json"], "--out")  // "report.json"
 */
export function parseString(argv: string[], flag: string): string | null {
  const idx = argv.indexOf(flag);
  return idx >= 0 && idx + 1 < argv.length ? (argv[idx + 1] ?? null) : null;
}

/**
 * Returns a positive integer value following `flag`, or `fallback` when the
 * flag is absent or the value is invalid. The result is always >= 1 when the
 * flag is present with a parseable value.
 *
 * @example parsePositiveInt(argv, "--limit", 5)
 */
export function parsePositiveInt(
  argv: string[],
  flag: string,
  fallback: number,
): number {
  const idx = argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= argv.length) return fallback;
  return Math.max(1, Number(argv[idx + 1]) || fallback);
}

/**
 * Appends unique, trimmed, non-empty items from a CSV string to `list`.
 * Existing items are never duplicated.
 *
 * @example addUniqueFromCsv(langs, "es,fr,es")  // appends "es", "fr" once
 */
export function addUniqueFromCsv(list: string[], csv: string): void {
  for (const item of csv.split(",").map((c) => c.trim()).filter(Boolean)) {
    if (!list.includes(item)) list.push(item);
  }
}

/**
 * Warns about an unrecognised CLI flag on stderr.
 */
export function warnUnknown(arg: string): void {
  console.warn(`Unknown flag: ${arg}`);
}

// ── Signal handling ────────────────────────────────────────────────────────

type SignalLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
};

/**
 * Registers SIGINT / SIGTERM handlers for long-running worker scripts.
 * The first signal aborts `controller`; a second signal forces exit with
 * code 130.
 */
export function registerShutdownSignals(
  controller: AbortController,
  logger: SignalLogger,
  runtime: SignalProcess = process,
): void {
  let signalled = false;
  const onSignal = (sig: string) => {
    if (signalled) {
      logger.warn(`received ${sig} again — forcing exit`);
      runtime.exit(130);
    }
    signalled = true;
    logger.info(`received ${sig} — stopping after current article…`);
    controller.abort();
  };
  runtime.on("SIGINT", () => onSignal("SIGINT"));
  runtime.on("SIGTERM", () => onSignal("SIGTERM"));
}
