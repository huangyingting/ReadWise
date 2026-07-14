process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

let migrateResult = { scanned: 0, migrated: 0, skippedCurrent: 0, failed: 0 };
let migrateArgs: Record<string, unknown> | null = null;
let repairResult = {
  scanned: 0,
  repaired: 0,
  skippedHasSpans: 0,
  skippedNoPlainText: 0,
  skippedAlignment: 0,
  failed: 0,
};
let repairArgs: Record<string, unknown> | null = null;

before(() => {
  mock.module("@/lib/speech/timing-migration", {
    namedExports: {
      migrateArticleSpeechTimings: async (args: Record<string, unknown>) => {
        migrateArgs = args;
        return migrateResult;
      },
      repairSpeechTimingSpans: async (args: Record<string, unknown>) => {
        repairArgs = args;
        return repairResult;
      },
    },
  });
});

beforeEach(() => {
  migrateResult = { scanned: 5, migrated: 2, skippedCurrent: 3, failed: 0 };
  migrateArgs = null;
  repairResult = {
    scanned: 66,
    repaired: 66,
    skippedHasSpans: 0,
    skippedNoPlainText: 0,
    skippedAlignment: 0,
    failed: 0,
  };
  repairArgs = null;
});

test("migrate-speech-timing parses optional args (migrate mode)", async () => {
  const { parseArgs } = await import("../scripts/migrate-speech-timing");

  assert.deepEqual(parseArgs(["--limit", "10", "--provider", "azure"]), {
    mode: "migrate",
    limit: 10,
    provider: "azure",
    target: "v2",
  });
  assert.deepEqual(parseArgs([]), { mode: "migrate", limit: undefined, provider: undefined, target: "v2" });
  assert.deepEqual(parseArgs(["--target", "v1"]), {
    mode: "migrate",
    limit: undefined,
    provider: undefined,
    target: "v1",
  });
  assert.deepEqual(parseArgs(["--target", "v2"]), {
    mode: "migrate",
    limit: undefined,
    provider: undefined,
    target: "v2",
  });
});

test("migrate-speech-timing parseArgs throws for explicit invalid --target", async () => {
  const { parseArgs } = await import("../scripts/migrate-speech-timing");

  assert.throws(
    () => parseArgs(["--target", "v3"]),
    /Invalid --target/,
  );
  assert.throws(
    () => parseArgs(["--target", "bad"]),
    /Invalid --target/,
  );
});

test("migrate-speech-timing parseArgs repair-spans mode defaults to dry-run", async () => {
  const { parseArgs } = await import("../scripts/migrate-speech-timing");

  assert.deepEqual(parseArgs(["--repair-spans"]), {
    mode: "repair-spans",
    ids: [],
    limit: undefined,
    apply: false,
  });
});

test("migrate-speech-timing parseArgs repair-spans with --apply", async () => {
  const { parseArgs } = await import("../scripts/migrate-speech-timing");

  assert.deepEqual(parseArgs(["--repair-spans", "--apply"]), {
    mode: "repair-spans",
    ids: [],
    limit: undefined,
    apply: true,
  });
});

test("migrate-speech-timing parseArgs repair-spans with --ids and --limit", async () => {
  const { parseArgs } = await import("../scripts/migrate-speech-timing");

  const args = parseArgs(["--repair-spans", "--ids", "id1,id2,id3", "--limit", "10", "--apply"]);
  assert.deepEqual(args, {
    mode: "repair-spans",
    ids: ["id1", "id2", "id3"],
    limit: 10,
    apply: true,
  });
});

test("migrate-speech-timing main returns success when no failures", async () => {
  const { main } = await import("../scripts/migrate-speech-timing");

  const originalArgv = process.argv;
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = ((...args: unknown[]) => logs.push(args.join(" "))) as typeof console.log;

  try {
    process.argv = [process.execPath, "scripts/migrate-speech-timing.ts", "--limit", "7", "--provider", "azure"];
    const code = await main();
    assert.equal(code, 0);
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
  }

  assert.deepEqual(migrateArgs, { limit: 7, provider: "azure", target: "v2" });
  assert.match(logs.join("\n"), /Starting speech timing migration/);
  assert.match(logs.join("\n"), /Migration complete/);
});

test("migrate-speech-timing main passes target v1 when requested", async () => {
  const { main } = await import("../scripts/migrate-speech-timing");

  const originalArgv = process.argv;
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = ((...args: unknown[]) => logs.push(args.join(" "))) as typeof console.log;

  try {
    process.argv = [process.execPath, "scripts/migrate-speech-timing.ts", "--target", "v1"];
    const code = await main();
    assert.equal(code, 0);
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
  }

  assert.deepEqual(migrateArgs, { limit: undefined, provider: undefined, target: "v1" });
  assert.match(logs.join("\n"), /target: v1/);
});

test("migrate-speech-timing main returns non-zero when failures exist", async () => {
  const { main } = await import("../scripts/migrate-speech-timing");

  migrateResult = { scanned: 4, migrated: 1, skippedCurrent: 1, failed: 2 };

  const originalArgv = process.argv;
  const originalError = console.error;
  const errors: string[] = [];
  console.error = ((...args: unknown[]) => errors.push(args.join(" "))) as typeof console.error;

  try {
    process.argv = [process.execPath, "scripts/migrate-speech-timing.ts"];
    const code = await main();
    assert.equal(code, 1);
  } finally {
    process.argv = originalArgv;
    console.error = originalError;
  }

  assert.match(errors.join("\n"), /row\(s\) failed/);
});

test("migrate-speech-timing repair-spans dry-run mode reports without writing", async () => {
  const { main } = await import("../scripts/migrate-speech-timing");

  const originalArgv = process.argv;
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = ((...args: unknown[]) => logs.push(args.join(" "))) as typeof console.log;

  try {
    process.argv = [process.execPath, "scripts/migrate-speech-timing.ts", "--repair-spans"];
    const code = await main();
    assert.equal(code, 0);
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
  }

  assert.ok(repairArgs !== null);
  assert.equal((repairArgs as Record<string, unknown>).dryRun, true);
  assert.match(logs.join("\n"), /dry-run/);
  assert.match(logs.join("\n"), /Re-run with --apply/);
});

test("migrate-speech-timing repair-spans apply mode writes repairs", async () => {
  const { main } = await import("../scripts/migrate-speech-timing");

  const originalArgv = process.argv;
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = ((...args: unknown[]) => logs.push(args.join(" "))) as typeof console.log;

  try {
    process.argv = [process.execPath, "scripts/migrate-speech-timing.ts", "--repair-spans", "--apply"];
    const code = await main();
    assert.equal(code, 0);
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
  }

  assert.ok(repairArgs !== null);
  assert.equal((repairArgs as Record<string, unknown>).dryRun, false);
  assert.match(logs.join("\n"), /Span repair complete/);
});

test("migrate-speech-timing repair-spans returns non-zero on failures", async () => {
  const { main } = await import("../scripts/migrate-speech-timing");

  repairResult = { scanned: 5, repaired: 3, skippedHasSpans: 0, skippedNoPlainText: 0, skippedAlignment: 0, failed: 2 };

  const originalArgv = process.argv;
  const originalError = console.error;
  const errors: string[] = [];
  console.error = ((...args: unknown[]) => errors.push(args.join(" "))) as typeof console.error;

  try {
    process.argv = [process.execPath, "scripts/migrate-speech-timing.ts", "--repair-spans", "--apply"];
    const code = await main();
    assert.equal(code, 1);
  } finally {
    process.argv = originalArgv;
    console.error = originalError;
  }

  assert.match(errors.join("\n"), /row\(s\) failed/);
});

test("migrate-speech-timing entrypoint executes runScript when module is main", async () => {
  const scriptUrl = new URL("../scripts/migrate-speech-timing.ts", import.meta.url).href;
  const scriptPath = fileURLToPath(scriptUrl);
  const originalArgv = process.argv;
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;
  const exits: Array<number | undefined> = [];

  let resolveExit: (() => void) | null = null;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  process.argv = [process.execPath, scriptPath];
  process.exit = ((code?: string | number | null | undefined): never => {
    exits.push(typeof code === "number" ? code : code == null ? 0 : Number(code));
    resolveExit?.();
    return undefined as never;
  }) as typeof process.exit;
  console.log = (() => undefined) as typeof console.log;
  console.error = (() => undefined) as typeof console.error;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { runAsCli } = await import("../scripts/migrate-speech-timing");
    runAsCli(scriptUrl);
    await Promise.race([
      exited,
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new Error("migrate-speech entrypoint did not exit")), 1000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    process.argv = originalArgv;
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
  }

  assert.deepEqual(exits, [0]);
});
