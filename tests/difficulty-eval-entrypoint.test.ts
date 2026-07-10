process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const DIFFICULTY_EVAL_SCRIPT = fileURLToPath(new URL("../scripts/difficulty-eval.ts", import.meta.url));

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

test("difficulty eval entrypoint uses runScript and exits with CLI code", async () => {
  const logs: string[] = [];
  const exitCodes: number[] = [];

  const originalArgv = process.argv;
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  let resolveExit: (() => void) | null = null;
  let rejectExit: ((reason?: unknown) => void) | null = null;
  const exited = new Promise<void>((resolve, reject) => {
    resolveExit = resolve;
    rejectExit = reject;
  });
  const timer = setTimeout(() => {
    rejectExit?.(new Error("difficulty-eval entrypoint did not exit"));
  }, 5000);

  process.argv = [process.execPath, DIFFICULTY_EVAL_SCRIPT];
  process.exit = ((code?: string | number | null | undefined): never => {
    const normalized = typeof code === "number"
      ? code
      : code == null
        ? 0
        : Number(code);
    exitCodes.push(Number.isFinite(normalized) ? normalized : 1);
    resolveExit?.();
    return undefined as never;
  }) as typeof process.exit;

  console.log = ((...parts: unknown[]) => {
    logs.push(parts.map(stringifyValue).join(" "));
  }) as typeof console.log;
  console.warn = ((...parts: unknown[]) => {
    logs.push(parts.map(stringifyValue).join(" "));
  }) as typeof console.warn;
  console.error = ((...parts: unknown[]) => {
    logs.push(parts.map(stringifyValue).join(" "));
  }) as typeof console.error;

  try {
    await import("../scripts/difficulty-eval");
    await exited;
  } finally {
    clearTimeout(timer);
    process.argv = originalArgv;
    process.exit = originalExit;
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.deepEqual(exitCodes, [2]);
  assert.match(logs.join("\n"), /Usage:/);
});
