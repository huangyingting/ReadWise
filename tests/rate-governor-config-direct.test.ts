process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

const countCalls: unknown[] = [];
const reserveCalls: unknown[] = [];
let providerFound = true;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        discoverySource: {
          count: async (args: unknown) => {
            countCalls.push(args);
            return 3;
          },
        },
      },
    },
  });
  mock.module("@/lib/scraper/providers", {
    namedExports: {
      getProvider: (providerKey: string) =>
        providerFound ? { key: providerKey, hostnames: ["shared.example", "www.example"] } : undefined,
    },
  });
  mock.module("@/lib/runtime-config/scraper", {
    namedExports: {
      scraperHostConcurrency: () => 7,
      scraperHostMinIntervalMs: () => 800,
      scraperHostDailyCeiling: () => 900,
      scraperProviderDailyQuota: () => 70,
      scraperDiscoveryDailyBudget: () => 11,
      scraperBodyDailyBudget: () => 22,
      scraperAiDailyBudget: () => 33,
      scraperIncrementalReservedSlots: () => 2,
      scraperBacklogCapacityThreshold: () => 44,
      scraperHostErrorPauseThreshold: () => 5,
      scraperHostPauseBaseMs: () => 6_000,
      scraperHostPauseMaxMs: () => 60_000,
    },
  });
  mock.module("@/lib/scraper/incremental/rate-governor-commit", {
    namedExports: {
      reserveHostnameRequest: async (args: unknown) => {
        reserveCalls.push(args);
        return { admitted: true, hostKey: "shared.example" };
      },
    },
  });
});

beforeEach(() => {
  countCalls.length = 0;
  reserveCalls.length = 0;
  providerFound = true;
});

test("rate governor config assembles every runtime knob", async () => {
  const config = await import("@/lib/scraper/incremental/rate-governor-config");

  assert.deepEqual(config.hostnameBudgetConfigFromEnv(), {
    maxConcurrency: 7,
    minIntervalMs: 800,
    dailyCeiling: 900,
  });
  assert.deepEqual(config.reservationConfigFromEnv(), { incrementalReservedSlots: 2 });
  assert.deepEqual(config.backoffConfigFromEnv(), {
    errorThreshold: 5,
    basePauseMs: 6_000,
    maxPauseMs: 60_000,
  });
  assert.deepEqual(config.backlogConfigFromEnv(), { capacityThreshold: 44 });
  assert.deepEqual(config.costBudgetsFromEnv(), { discovery: 11, body: 22, ai: 33 });
  assert.equal(config.providerDailyQuotaFromEnv(), 70);
});

test("rate governor resolves a shared hostname and safe provider fallback", async () => {
  const { resolveHostKey } = await import("@/lib/scraper/incremental/rate-governor-config");
  assert.equal(resolveHostKey("undark"), "shared.example");
  providerFound = false;
  assert.equal(resolveHostKey("unknown"), "unknown");
});

test("rate governor derives peer leases and wires the discovery reservation", async () => {
  const { deriveHostnameInFlight, makeDiscoveryGovernorGate } = await import(
    "@/lib/scraper/incremental/rate-governor-config"
  );
  const now = new Date("2026-07-31T00:00:00Z");

  assert.equal(await deriveHostnameInFlight({ providerKey: "undark", selfSourceId: "self", now }), 3);
  assert.deepEqual(countCalls[0], {
    where: {
      providerKey: "undark",
      leaseOwner: { not: null },
      leaseExpiresAt: { gt: now },
      id: { not: "self" },
    },
  });

  const gate = makeDiscoveryGovernorGate();
  const result = await gate.reserve({
    source: { id: "source-1", providerKey: "undark" } as never,
    now,
  });

  assert.deepEqual(result, { admitted: true, hostKey: "shared.example" });
  assert.deepEqual(reserveCalls[0], {
    hostKey: "shared.example",
    inFlight: 3,
    requestClass: "discovery",
    priorityTier: "incremental",
    config: { maxConcurrency: 7, minIntervalMs: 800, dailyCeiling: 900 },
    reservation: { incrementalReservedSlots: 2 },
    now,
  });
});
