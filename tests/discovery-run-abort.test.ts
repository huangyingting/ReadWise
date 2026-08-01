/** Cooperative-shutdown coverage for a claimed discovery-source run. */
process.env.LOG_LEVEL = "error";

import { before, mock, test } from "node:test";
import assert from "node:assert/strict";
import type { ClaimedDiscoverySource } from "@/lib/scraper/incremental/discovery-claim";

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
const NOW = new Date("2026-07-31T12:00:00.000Z");

function claimed(): ClaimedDiscoverySource {
  return {
    source: {
      id: "source-abort",
      providerKey: "provider",
      leaseOwner: "worker-abort",
      definitionVersion: 1,
      role: "PRIMARY_FEED",
      automationPolicy: "SCHEDULED",
      lifecycleMode: "ACTIVE",
      pollIntervalSeconds: 900,
      scheduleCron: null,
      backoffLevel: 2,
      consecutiveFailures: 4,
    } as unknown as ClaimedDiscoverySource["source"],
    wasStale: false,
  };
}

test("shutdown abort releases the discovery lease without recording a provider failure", async () => {
  releaseCalls.length = 0;
  const { runClaimedDiscoverySource } = await import("@/lib/scraper/incremental/discovery-run");
  const controller = new AbortController();

  await assert.rejects(
    () => runClaimedDiscoverySource(claimed(), silentLogger, {
      now: () => NOW,
      fetchPage: async () => {
        controller.abort();
        throw new Error("transport stopped during shutdown");
      },
    }, controller.signal),
    { name: "AbortError" },
  );

  assert.equal(releaseCalls.length, 1);
  assert.equal(releaseCalls[0]?.leaseOwner, null);
  assert.equal(releaseCalls[0]?.leaseAcquiredAt, null);
  assert.equal(releaseCalls[0]?.leaseExpiresAt, null);
  assert.equal(releaseCalls[0]?.backoffLevel, undefined);
  assert.equal(releaseCalls[0]?.consecutiveFailures, undefined);
  assert.equal(releaseCalls[0]?.backoffUntil, undefined);
  assert.equal(releaseCalls[0]?.lastError, undefined);
});

test("discovery failures expose a controlled reason instead of exception prose", async () => {
  const { redactErrorForSource } = await import("@/lib/scraper/incremental/discovery-run");
  const reason = redactErrorForSource(new Error("private article sentence from provider"));
  assert.equal(reason, "discovery_source_failed");
  assert.doesNotMatch(reason, /private article sentence/);
});

test("canary failures preserve an approved machine reason", async () => {
  const { redactErrorForSource } = await import("@/lib/scraper/incremental/discovery-run");
  const error = new Error("private provider response");
  error.name = "CanaryFetchError";
  Object.assign(error, { reason: "canary_contract_failed" });

  assert.equal(redactErrorForSource(error), "canary_contract_failed");
});
