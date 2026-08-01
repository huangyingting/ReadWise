/** Concurrent cap-race and read/helper coverage for rate-governor persistence. */
process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

let outerWindowCount = 0;
let directIncrementCount = 1;
let transactionIncrementCount = 1;
let transactionError: Error | null = null;

const hostState = {
  consecutiveErrors: 0,
  pausedUntil: null,
  lastFailureReason: null,
  lastRequestAt: null,
};

before(() => {
  const directClient = {
    scraperBudgetWindow: {
      findUnique: async () => ({ requestCount: outerWindowCount }),
      upsert: async () => ({ requestCount: directIncrementCount }),
    },
    hostnameGovernorState: {
      findUnique: async () => hostState,
      upsert: async () => ({}),
    },
  };
  const transactionClient = {
    scraperBudgetWindow: {
      findUnique: async () => ({ requestCount: outerWindowCount }),
      upsert: async () => ({ requestCount: transactionIncrementCount }),
    },
    hostnameGovernorState: {
      findUnique: async () => hostState,
      upsert: async () => ({}),
    },
  };
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        ...directClient,
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
          if (transactionError) throw transactionError;
          return fn(transactionClient);
        },
      },
    },
  });
});

beforeEach(() => {
  outerWindowCount = 0;
  directIncrementCount = 1;
  transactionIncrementCount = 1;
  transactionError = null;
});

const NOW = new Date("2026-07-31T21:00:00.000Z");
const reservationInput = {
  hostKey: "host-governor-branches",
  inFlight: 0,
  requestClass: "discovery" as const,
  priorityTier: "incremental" as const,
  config: { maxConcurrency: 4, minIntervalMs: 0, dailyCeiling: 1 },
  reservation: { incrementalReservedSlots: 0 },
  now: NOW,
};

test("a concurrent hostname increment that crosses the ceiling rolls back to defer", async () => {
  const { reserveHostnameRequest } = await import("@/lib/scraper/incremental/rate-governor-commit");
  transactionIncrementCount = 2;

  assert.deepEqual(await reserveHostnameRequest(reservationInput), {
    decision: "defer",
    reason: "daily-ceiling",
    retryAt: null,
  });
});

test("an unrelated hostname reservation transaction failure propagates", async () => {
  const { reserveHostnameRequest } = await import("@/lib/scraper/incremental/rate-governor-commit");
  const error = new Error("database unavailable");
  transactionError = error;

  await assert.rejects(() => reserveHostnameRequest(reservationInput), error);
});

test("an unrelated cost-budget transaction failure propagates", async () => {
  const { consumeCostBudget } = await import("@/lib/scraper/incremental/rate-governor-commit");
  const error = new Error("transaction unavailable");
  transactionError = error;

  await assert.rejects(
    () => consumeCostBudget({ kind: "body", dailyBudget: 10, now: NOW }),
    error,
  );
});

test("cost-budget status reports current usage and remaining capacity without mutation", async () => {
  const { readCostBudgetStatus } = await import("@/lib/scraper/incremental/rate-governor-commit");
  outerWindowCount = 7;

  assert.deepEqual(await readCostBudgetStatus({ kind: "ai", dailyBudget: 10, now: NOW }), {
    used: 7,
    exhausted: false,
    remaining: 3,
  });
});

test("an unlimited provider quota increments and admits without a transaction", async () => {
  const { consumeProviderQuota } = await import("@/lib/scraper/incremental/rate-governor-commit");
  directIncrementCount = 12;

  assert.deepEqual(
    await consumeProviderQuota({ providerKey: "provider-governor-branches", dailyQuota: 0, now: NOW }),
    { admitted: true, used: 12 },
  );
});

test("an unrelated provider-quota transaction failure propagates", async () => {
  const { consumeProviderQuota } = await import("@/lib/scraper/incremental/rate-governor-commit");
  const error = new Error("provider quota unavailable");
  transactionError = error;

  await assert.rejects(
    () => consumeProviderQuota({ providerKey: "provider-governor-branches", dailyQuota: 10, now: NOW }),
    error,
  );
});
