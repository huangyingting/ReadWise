process.env.LOG_LEVEL = "error";

import { before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: { findMany: async () => [] },
        $disconnect: async () => {},
      },
    },
  });
  mock.module("@/lib/storage", {
    namedExports: {
      getMediaStorage: () => null,
      isObjectStorageConfigured: () => false,
    },
  });
  mock.module("@/lib/worker", {
    namedExports: {
      createConsoleLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    },
  });
});

async function loadBatchSynthesis() {
  return import("../scripts/batch-synthesis");
}

function silentLogger() {
  return {
    log: () => {},
    error: () => {},
  };
}

describe("batch synthesis CLI parsing", () => {
  test("parses loop flags and defaults", async () => {
    const { parseArgs } = await loadBatchSynthesis();

    const defaults = parseArgs(["--all"]);
    assert.equal(defaults.loop, false);
    assert.equal(defaults.sleepMs, 60_000);
    assert.equal(defaults.maxPasses, null);
    assert.equal(defaults.maxErrors, 5);
    assert.equal(defaults.limit, null);

    const args = parseArgs([
      "--all",
      "--loop",
      "--sleep",
      "250",
      "--max-passes",
      "3",
      "--max-errors",
      "2",
    ]);
    assert.equal(args.loop, true);
    assert.equal(args.sleepMs, 250);
    assert.equal(args.maxPasses, 3);
    assert.equal(args.maxErrors, 2);
    assert.equal(args.limit, 50);
  });

  test("clamps loop sleep to non-negative and treats max-passes 0 as unlimited", async () => {
    const { parseArgs } = await loadBatchSynthesis();

    const args = parseArgs(["--all", "--loop", "--sleep", "-1", "--max-passes", "0"]);
    assert.equal(args.sleepMs, 0);
    assert.equal(args.maxPasses, null);
  });
});

describe("batch synthesis loop orchestration", () => {
  test("stops after max passes", async () => {
    const { parseArgs, runLoop } = await loadBatchSynthesis();
    const args = parseArgs(["--all", "--loop", "--max-passes", "3", "--sleep", "0"]);
    const controller = new AbortController();
    let calls = 0;
    let sleeps = 0;

    const code = await runLoop(args, {
      signal: controller.signal,
      logger: silentLogger(),
      sleep: async () => {
        sleeps++;
      },
      runPass: async () => {
        calls++;
        return { selected: 1, submitted: 1, persisted: 1 };
      },
    });

    assert.equal(code, 0);
    assert.equal(calls, 3);
    assert.equal(sleeps, 2);
  });

  test("aborts after max consecutive errors", async () => {
    const { parseArgs, runLoop } = await loadBatchSynthesis();
    const args = parseArgs([
      "--all",
      "--loop",
      "--max-passes",
      "10",
      "--max-errors",
      "2",
      "--sleep",
      "0",
    ]);
    let calls = 0;

    const code = await runLoop(args, {
      signal: new AbortController().signal,
      logger: silentLogger(),
      sleep: async () => {},
      runPass: async () => {
        calls++;
        throw new Error("synthetic failure");
      },
    });

    assert.equal(code, 1);
    assert.equal(calls, 2);
  });

  test("resets consecutive error counter after a success", async () => {
    const { parseArgs, runLoop } = await loadBatchSynthesis();
    const args = parseArgs([
      "--all",
      "--loop",
      "--max-passes",
      "4",
      "--max-errors",
      "2",
      "--sleep",
      "0",
    ]);
    const outcomes = ["fail", "success", "fail", "fail"];
    let calls = 0;

    const code = await runLoop(args, {
      signal: new AbortController().signal,
      logger: silentLogger(),
      sleep: async () => {},
      runPass: async () => {
        const outcome = outcomes[calls++];
        if (outcome === "fail") throw new Error("synthetic failure");
        return { selected: 1, submitted: 1, persisted: 1 };
      },
    });

    assert.equal(code, 1);
    assert.equal(calls, 4);
  });
});
