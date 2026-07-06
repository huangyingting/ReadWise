import assert from "node:assert/strict";
import { test } from "node:test";

import { instrumentPrismaClient } from "@/lib/prisma-instrumentation";

type FakeClient = Record<string | symbol, unknown>;

async function captureWarns(fn: () => Promise<void> | void): Promise<Array<Record<string, unknown>>> {
  const originalWarn = console.warn;
  const lines: string[] = [];
  console.warn = ((line: string) => {
    lines.push(line);
  }) as typeof console.warn;
  try {
    await fn();
  } finally {
    console.warn = originalWarn;
  }
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("Prisma instrumentation times root raw queries without wrapping transactions or logging query text", async () => {
  const rawArgs: unknown[][] = [];
  const rawReceivers: unknown[] = [];
  const transaction = async () => "transaction-result";
  const transactionClient = { marker: "transaction-client" };
  const client: FakeClient = {
    marker: "root-client",
    $executeRawUnsafe: async function executeRaw(this: { marker?: string }, ...args: unknown[]) {
      rawReceivers.push(this);
      rawArgs.push(args);
      return this.marker ?? "raw-result";
    },
    $transaction: transaction,
  };

  const logs = await captureWarns(async () => {
    const instrumented = instrumentPrismaClient(client, {
      enabled: true,
      provider: "postgresql",
      slowThresholdMs: 0,
    });

    assert.equal(instrumented.$transaction, transaction);
    const executeRaw = instrumented.$executeRawUnsafe as (this: unknown, ...args: unknown[]) => Promise<unknown>;
    assert.equal(
      await executeRaw.call(transactionClient, "SELECT secret_value"),
      "transaction-client",
    );
  });

  assert.deepEqual(rawArgs, [["SELECT secret_value"]]);
  assert.deepEqual(rawReceivers, [transactionClient]);
  const slowQuery = logs.find((line) => line.message === "db.slow_query");
  assert.ok(slowQuery);
  assert.equal(slowQuery.provider, "postgresql");
  assert.equal(slowQuery.model, "client");
  assert.equal(slowQuery.operation, "executerawunsafe");
  assert.equal(JSON.stringify(slowQuery).includes("secret_value"), false);
});

test("Prisma instrumentation degrades gracefully when raw method patching is blocked", async () => {
  const originalQueryRaw = async () => "query-result";
  const client: FakeClient = {};
  Object.defineProperty(client, "$queryRaw", {
    configurable: false,
    writable: false,
    value: originalQueryRaw,
  });

  const logs = await captureWarns(() => {
    const instrumented = instrumentPrismaClient(client, {
      enabled: true,
      provider: "sqlite",
      slowThresholdMs: 250,
    });
    assert.equal(instrumented.$queryRaw, originalQueryRaw);
  });

  const skipped = logs.find((line) => line.message === "db.raw_instrumentation_skipped");
  assert.ok(skipped);
  assert.equal(skipped.provider, "sqlite");
  assert.equal(skipped.operation, "queryraw");
});

test("Prisma instrumentation falls back to the original client when model extension fails", async () => {
  const client: FakeClient = {
    $extends: () => {
      throw new Error("extension unavailable");
    },
  };

  const logs = await captureWarns(() => {
    const instrumented = instrumentPrismaClient(client, {
      enabled: true,
      provider: "postgresql",
      slowThresholdMs: 250,
    });
    assert.equal(instrumented, client);
  });

  const skipped = logs.find((line) => line.message === "db.model_instrumentation_skipped");
  assert.ok(skipped);
  assert.equal(skipped.provider, "postgresql");
  assert.equal(JSON.stringify(skipped).includes("extension unavailable"), false);
});
