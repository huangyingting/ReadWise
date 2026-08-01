/** Controlled commit-refusal and trust-demotion coverage for discovery runs. */
process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

import { DiscoverySourceLifecycleMode } from "@prisma/client";
import type { ClaimedDiscoverySource } from "@/lib/scraper/incremental/discovery-claim";

const releaseCalls: Array<Record<string, unknown>> = [];
let degradationDemoted = false;
let trustDemoted = false;

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
  mock.module("@/lib/scraper/incremental/observability-query", {
    namedExports: {
      evaluateAndApplyDegradation: async () => ({ demoted: degradationDemoted }),
    },
  });
  mock.module("@/lib/scraper/incremental/source-trust-commit", {
    namedExports: {
      evaluateAndApplyTrustDemotion: async () => ({ demoted: trustDemoted }),
    },
  });
});

beforeEach(() => {
  releaseCalls.length = 0;
  degradationDemoted = false;
  trustDemoted = false;
});

const NOW = new Date("2026-07-31T14:00:00.000Z");
const logger = { info: () => {}, warn: () => {}, error: () => {} };

function claimed(): ClaimedDiscoverySource {
  return {
    source: {
      id: "source-branches",
      providerKey: "provider-branches",
      leaseOwner: "worker-branches",
      definitionVersion: 3,
      role: "PRIMARY_FEED",
      automationPolicy: "SCHEDULED",
      lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
      pollIntervalSeconds: 900,
      scheduleCron: null,
      backoffLevel: 0,
      consecutiveFailures: 0,
      consecutiveZeroDiscoveryRuns: 0,
      autoPublishTrusted: true,
    } as unknown as ClaimedDiscoverySource["source"],
    wasStale: false,
  };
}

const fetchedPage = {
  items: [],
  nextCursor: null,
  nextPage: null,
  boundaryReached: true,
} as never;

const committedPage = {
  committed: true,
  outcomes: {
    eligible: 0,
    "baseline-shadow": 0,
    "existing-identity": 0,
    "policy-rejected": 0,
    "outside-window": 0,
    "review-required": 0,
  },
  itemsCommitted: 0,
  candidatesUpserted: 0,
  aliasesUpserted: 0,
  observationsUpserted: 0,
  ingestJobsEnqueued: 0,
  checkpoint: { cursor: null, page: null },
  boundaryReached: true,
} as const;

test("a page-commit refusal returns lease-lost without advancing the frontier", async () => {
  const { runClaimedDiscoverySource } = await import("@/lib/scraper/incremental/discovery-run");
  let frontierCalled = false;

  const outcome = await runClaimedDiscoverySource(claimed(), logger, {
    now: () => NOW,
    fetchPage: async () => fetchedPage,
    commitPage: async () => ({ committed: false, reason: "lease-lost" }),
    commitFrontier: async () => {
      frontierCalled = true;
      return { committed: true, watermarkAdvanced: false, gapState: "NONE", validatorDisabled: false } as never;
    },
  });

  assert.deepEqual(outcome, { status: "lease-lost" });
  assert.equal(frontierCalled, false);
  assert.equal(releaseCalls.length, 0, "the worker no longer owns a lease to release");
});

test("a frontier-commit refusal returns lease-lost without finalizing success", async () => {
  const { runClaimedDiscoverySource } = await import("@/lib/scraper/incremental/discovery-run");

  const outcome = await runClaimedDiscoverySource(claimed(), logger, {
    now: () => NOW,
    fetchPage: async () => fetchedPage,
    commitPage: async () => committedPage,
    commitFrontier: async () => ({ committed: false, reason: "lease-lost" }),
  });

  assert.deepEqual(outcome, { status: "lease-lost" });
  assert.equal(releaseCalls.length, 0, "the worker no longer owns a lease to release");
});

test("trust demotion revokes in-memory trust and schedules from SHADOW mode", async () => {
  const { runClaimedDiscoverySource } = await import("@/lib/scraper/incremental/discovery-run");
  trustDemoted = true;
  const claim = claimed();

  const outcome = await runClaimedDiscoverySource(claim, logger, {
    now: () => NOW,
    fetchPage: async () => fetchedPage,
    commitPage: async () => committedPage,
    commitFrontier: async () => ({
      committed: true,
      watermarkAdvanced: false,
      gapState: "NONE",
      validatorDisabled: false,
    }) as never,
  });

  assert.equal(outcome.status, "committed");
  assert.equal(claim.source.autoPublishTrusted, false);
  assert.equal(claim.source.lifecycleMode, DiscoverySourceLifecycleMode.SHADOW);
  assert.equal(releaseCalls.length, 1);
});
