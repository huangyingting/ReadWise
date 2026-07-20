/**
 * CLI unit tests for scripts/reap-orphan-narration.ts (#1131).
 *
 * The reaper library is fully mocked (its DB behaviour is covered by the
 * integration suite), so these assert ONLY the CLI contract: dry-run default,
 * --execute wiring, --grace-minutes / --limit forwarding, help text, and
 * metadata-only JSON output. Mirrors tests/reconcile-rescrape-regen-cli.test.ts.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

let countReturn = 0;
let reapReturn = { matched: 0, reaped: 0, failed: 0 };
let countArgs: Array<{ graceMs?: number; now?: Date }> = [];
let reapArgs: Array<{ graceMs?: number; now?: Date; limit?: number }> = [];

before(() => {
  mock.module("@/lib/media/orphan-narration-retention", {
    namedExports: {
      REAP_DEFAULT_LIMIT: 200,
      ORPHAN_NARRATION_GRACE_MINUTES: 60,
      countOrphanedNarrationAssets: async (opts: { graceMs?: number; now?: Date } = {}) => {
        countArgs.push(opts);
        return countReturn;
      },
      reapOrphanedNarrationAssets: async (
        opts: { graceMs?: number; now?: Date; limit?: number } = {},
      ) => {
        reapArgs.push(opts);
        return reapReturn;
      },
    },
  });
});

beforeEach(() => {
  countReturn = 4;
  reapReturn = { matched: 3, reaped: 3, failed: 0 };
  countArgs = [];
  reapArgs = [];
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

test("reap defaults to dry-run count output", async () => {
  const { reapOrphanNarrationMain } = await import("../scripts/reap-orphan-narration");
  const { io, logs, errors } = captureIo();

  const code = await reapOrphanNarrationMain([], io);
  const payload = JSON.parse(logs[0]!) as {
    dryRun: boolean;
    executed: boolean;
    graceMinutes: number;
    matched: number;
    reaped: number;
    failed: number;
  };

  assert.equal(code, 0);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.executed, false);
  assert.equal(payload.graceMinutes, 60);
  assert.equal(payload.matched, 4);
  assert.equal(payload.reaped, 0);
  assert.equal(payload.failed, 0);
  assert.equal(countArgs.length, 1);
  // Default grace (60 min) forwarded as milliseconds.
  assert.equal(countArgs[0]!.graceMs, 60 * 60 * 1000);
  assert.deepEqual(reapArgs, []);
  assert.match(errors[0]!, /Dry run only/);
});

test("reap prints help without running", async () => {
  const { reapOrphanNarrationMain } = await import("../scripts/reap-orphan-narration");
  const { io, logs, errors } = captureIo();

  const code = await reapOrphanNarrationMain(["--help"], io);

  assert.equal(code, 0);
  assert.match(logs[0]!, /maintenance:orphan-narration/);
  assert.deepEqual(countArgs, []);
  assert.deepEqual(reapArgs, []);
  assert.deepEqual(errors, []);
});

test("reap --execute reaps and reports the tally", async () => {
  reapReturn = { matched: 3, reaped: 2, failed: 1 };
  const { reapOrphanNarrationMain } = await import("../scripts/reap-orphan-narration");
  const { io, logs, errors } = captureIo();

  const code = await reapOrphanNarrationMain(["--execute"], io);
  const payload = JSON.parse(logs[0]!) as {
    executed: boolean;
    matched: number;
    reaped: number;
    failed: number;
  };

  assert.equal(code, 0);
  assert.equal(payload.executed, true);
  assert.equal(payload.matched, 3);
  assert.equal(payload.reaped, 2);
  assert.equal(payload.failed, 1);
  assert.deepEqual(countArgs, []);
  assert.equal(reapArgs.length, 1);
  assert.deepEqual(errors, []);
});

test("reap forwards --grace-minutes and --limit to the sweep", async () => {
  const { reapOrphanNarrationMain } = await import("../scripts/reap-orphan-narration");
  const { io } = captureIo();

  await reapOrphanNarrationMain(["--execute", "--grace-minutes", "30", "--limit", "25"], io);

  assert.equal(reapArgs.length, 1);
  assert.equal(reapArgs[0]!.graceMs, 30 * 60 * 1000);
  assert.equal(reapArgs[0]!.limit, 25);
});

test("reap forwards --grace-minutes to the dry-run count", async () => {
  const { reapOrphanNarrationMain } = await import("../scripts/reap-orphan-narration");
  const { io } = captureIo();

  await reapOrphanNarrationMain(["--grace-minutes", "15"], io);

  assert.equal(countArgs.length, 1);
  assert.equal(countArgs[0]!.graceMs, 15 * 60 * 1000);
  assert.deepEqual(reapArgs, []);
});
