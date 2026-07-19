/**
 * Unit tests for the #1094 rate-governor gate in the bounded discovery run.
 *
 * Network/DB-free: `prisma` is mocked and the fetch/commit seams are injected.
 * Proves that a governed `defer`/`paused` reschedules the source WITHOUT
 * fetching (so discovery never exceeds the shared hostname budget) while an
 * `admit` proceeds to the normal bounded page fetch.
 */
import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

import type { AdmissionDecision } from "@/lib/scraper/incremental/rate-governor";
import type { ClaimedDiscoverySource } from "@/lib/scraper/incremental/discovery-claim";

process.env.LOG_LEVEL = "error";

const releaseCalls: Array<Record<string, unknown>> = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        discoverySource: {
          updateMany: async ({ data }: { data: Record<string, unknown> }) => {
            releaseCalls.push(data);
            return { count: 1 };
          },
        },
      },
    },
  });
});

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };
const NOW = new Date("2026-07-19T12:00:00.000Z");

function claimed(): ClaimedDiscoverySource {
  return {
    source: {
      id: "src-1",
      providerKey: "prov",
      leaseOwner: "worker-x",
      definitionVersion: 1,
      role: "PRIMARY_FEED",
      automationPolicy: "SCHEDULED",
      lifecycleMode: "ACTIVE",
      pollIntervalSeconds: 900,
      scheduleCron: null,
      backoffLevel: 0,
    } as unknown as ClaimedDiscoverySource["source"],
    wasStale: false,
  };
}

test("gate: a governed defer reschedules to retryAt and does NOT fetch", async () => {
  releaseCalls.length = 0;
  const { runClaimedDiscoverySource } = await import("@/lib/scraper/incremental/discovery-run");
  let fetched = false;
  const retryAt = new Date(NOW.getTime() + 5_000);

  const outcome = await runClaimedDiscoverySource(claimed(), silentLogger, {
    now: () => NOW,
    fetchPage: async () => {
      fetched = true;
      throw new Error("must not fetch when deferred");
    },
    governor: {
      reserve: async (): Promise<AdmissionDecision> => ({
        decision: "defer",
        reason: "min-interval",
        retryAt,
      }),
    },
  });

  assert.equal(fetched, false);
  assert.equal(outcome.status, "deferred");
  if (outcome.status === "deferred") {
    assert.equal(outcome.reason, "min-interval");
    assert.equal(outcome.nextRunAt?.getTime(), retryAt.getTime());
  }
  assert.equal(releaseCalls[0]?.nextRunAt as unknown, retryAt);
});

test("gate: a governed pause reschedules to the pause expiry and does NOT fetch", async () => {
  releaseCalls.length = 0;
  const { runClaimedDiscoverySource } = await import("@/lib/scraper/incremental/discovery-run");
  const until = new Date(NOW.getTime() + 60_000);

  const outcome = await runClaimedDiscoverySource(claimed(), silentLogger, {
    now: () => NOW,
    fetchPage: async () => {
      throw new Error("must not fetch when paused");
    },
    governor: {
      reserve: async (): Promise<AdmissionDecision> => ({ decision: "paused", until }),
    },
  });

  assert.equal(outcome.status, "deferred");
  if (outcome.status === "deferred") {
    assert.equal(outcome.reason, "paused");
    assert.equal(outcome.nextRunAt?.getTime(), until.getTime());
  }
});

test("gate: an admit proceeds to fetch (does NOT short-circuit the run)", async () => {
  releaseCalls.length = 0;
  const { runClaimedDiscoverySource } = await import("@/lib/scraper/incremental/discovery-run");
  let fetched = false;

  const outcome = await runClaimedDiscoverySource(claimed(), silentLogger, {
    now: () => NOW,
    fetchPage: async () => {
      fetched = true;
      // The gate admitted, so the run reaches the fetch. We deliberately fail
      // fetch here to prove the run advances past the gate WITHOUT deferring;
      // the full committed path is covered by the no-governor loop tests.
      throw new Error("fetch reached after admit");
    },
    governor: {
      reserve: async (): Promise<AdmissionDecision> => ({ decision: "admit" }),
    },
  });

  assert.equal(fetched, true);
  assert.notEqual(outcome.status, "deferred");
});
