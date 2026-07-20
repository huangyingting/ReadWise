/**
 * CLI unit tests for scripts/reconcile-rescrape-regen.ts (#1132).
 *
 * The reconcile library is fully mocked (its DB behaviour is covered by the
 * integration suite), so these assert ONLY the CLI contract: dry-run default,
 * --execute wiring, --limit forwarding, help text, and metadata-only JSON output.
 * Mirrors tests/maintenance-cli.test.ts.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

let countReturn = 0;
let reconcileReturn = { scanned: 0, reDriven: 0, alreadyClaimed: 0 };
let countCalls = 0;
let reconcileArgs: Array<{ limit?: number; now?: Date }> = [];

before(() => {
  mock.module("@/lib/scraper/incremental/rescrape-regen-reconcile", {
    namedExports: {
      RECONCILE_DEFAULT_LIMIT: 100,
      countUnclaimedRescrapeRegen: async () => {
        countCalls += 1;
        return countReturn;
      },
      reconcileUnclaimedRescrapeRegen: async (opts: { limit?: number; now?: Date } = {}) => {
        reconcileArgs.push(opts);
        return reconcileReturn;
      },
    },
  });
});

beforeEach(() => {
  countReturn = 3;
  reconcileReturn = { scanned: 2, reDriven: 2, alreadyClaimed: 0 };
  countCalls = 0;
  reconcileArgs = [];
});

function captureIo() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    io: {
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
    },
  };
}

test("reconcile defaults to dry-run count output", async () => {
  const { reconcileRescrapeRegenMain } = await import("../scripts/reconcile-rescrape-regen");
  const { io, logs, errors } = captureIo();

  const code = await reconcileRescrapeRegenMain([], io);
  const payload = JSON.parse(logs[0]!) as {
    dryRun: boolean;
    executed: boolean;
    matched: number;
    reDriven: number;
    alreadyClaimed: number;
  };

  assert.equal(code, 0);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.executed, false);
  assert.equal(payload.matched, 3);
  assert.equal(payload.reDriven, 0);
  assert.equal(payload.alreadyClaimed, 0);
  assert.equal(countCalls, 1);
  assert.deepEqual(reconcileArgs, []);
  assert.match(errors[0]!, /Dry run only/);
});

test("reconcile prints help without running", async () => {
  const { reconcileRescrapeRegenMain } = await import("../scripts/reconcile-rescrape-regen");
  const { io, logs, errors } = captureIo();

  const code = await reconcileRescrapeRegenMain(["--help"], io);

  assert.equal(code, 0);
  assert.match(logs[0]!, /maintenance:rescrape-regen/);
  assert.equal(countCalls, 0);
  assert.deepEqual(reconcileArgs, []);
  assert.deepEqual(errors, []);
});

test("reconcile --execute re-drives and reports the tally", async () => {
  reconcileReturn = { scanned: 2, reDriven: 1, alreadyClaimed: 1 };
  const { reconcileRescrapeRegenMain } = await import("../scripts/reconcile-rescrape-regen");
  const { io, logs, errors } = captureIo();

  const code = await reconcileRescrapeRegenMain(["--execute"], io);
  const payload = JSON.parse(logs[0]!) as {
    executed: boolean;
    matched: number;
    reDriven: number;
    alreadyClaimed: number;
  };

  assert.equal(code, 0);
  assert.equal(payload.executed, true);
  assert.equal(payload.matched, 2);
  assert.equal(payload.reDriven, 1);
  assert.equal(payload.alreadyClaimed, 1);
  assert.equal(countCalls, 0);
  assert.equal(reconcileArgs.length, 1);
  assert.deepEqual(errors, []);
});

test("reconcile forwards --limit to the sweep", async () => {
  const { reconcileRescrapeRegenMain } = await import("../scripts/reconcile-rescrape-regen");
  const { io } = captureIo();

  await reconcileRescrapeRegenMain(["--execute", "--limit", "25"], io);

  assert.equal(reconcileArgs.length, 1);
  assert.equal(reconcileArgs[0]!.limit, 25);
});
