/** Listing, delay-sanitization, and degradation failure coverage. */
process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

import {
  CrawlCandidateStatus,
  DiscoveryAutomationPolicy,
  DiscoveryGapState,
  DiscoverySourceHealth,
  DiscoverySourceLifecycleMode,
  DiscoverySourceRole,
} from "@prisma/client";

const NOW = new Date("2026-07-31T20:00:00.000Z");
const source = {
  id: "source-observability-branches",
  providerKey: "provider-observability-branches",
  sourceKey: "primary",
  definitionVersion: 2,
  role: DiscoverySourceRole.PRIMARY_FEED,
  lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
  automationPolicy: DiscoveryAutomationPolicy.SCHEDULED,
  health: DiscoverySourceHealth.HEALTHY,
  gapState: DiscoveryGapState.NONE,
  gapDetectedAt: null,
  watermarkAt: new Date(NOW.getTime() - 60_000),
  baselineCompletedAt: new Date(NOW.getTime() - 120_000),
  baselineObservedCount: 4,
  lastRunAt: new Date(NOW.getTime() - 30_000),
  nextRunAt: NOW,
  activatedAt: new Date(NOW.getTime() - 90_000),
  backoffLevel: 0,
  backoffUntil: null,
  consecutiveFailures: 0,
  consecutiveZeroDiscoveryRuns: 0,
  discoveryBudgetPerRun: null,
};

let findManyArgs: Record<string, unknown> | null = null;
let countCalls = 0;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        discoverySource: {
          findMany: async (args: Record<string, unknown>) => {
            findManyArgs = args;
            return [source];
          },
          findUnique: async () => source,
        },
        crawlCandidate: {
          groupBy: async () => [
            { status: CrawlCandidateStatus.QUEUED, _count: { _all: 2 } },
          ],
          findMany: async () => [
            { trustedPublishedAt: null, firstObservedAt: NOW },
            {
              trustedPublishedAt: NOW,
              firstObservedAt: new Date(NOW.getTime() - 1_000),
            },
            {
              trustedPublishedAt: new Date(NOW.getTime() - 5_000),
              firstObservedAt: NOW,
            },
          ],
          count: async () => {
            countCalls += 1;
            return countCalls === 1 ? 6 : 12;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  findManyArgs = null;
  countCalls = 0;
});

test("source metric listing applies filters, bounds rows, and computes each summary", async () => {
  const { listDiscoverySourceMetrics } = await import("@/lib/scraper/incremental/observability-query");

  const rows = await listDiscoverySourceMetrics(
    {
      providerKey: source.providerKey,
      lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
      limit: 900,
    },
    NOW,
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.metrics.totalCandidates, 2);
  assert.deepEqual(findManyArgs?.where, {
    providerKey: source.providerKey,
    lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
  });
  assert.equal(findManyArgs?.take, 500);
});

test("detail metrics discard null/negative delays and retain valid observations", async () => {
  const { getDiscoverySourceMetrics } = await import("@/lib/scraper/incremental/observability-query");

  const dto = await getDiscoverySourceMetrics(source.id, NOW);

  assert.equal(dto?.metrics.publicationToDiscoveryDelay?.p50Seconds, 5);
  assert.equal(dto?.metrics.publicationToDiscoveryDelay?.maxSeconds, 5);
});

function driftSource(leaseOwner: string | null) {
  return {
    id: source.id,
    providerKey: source.providerKey,
    lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
    leaseOwner,
    definitionVersion: source.definitionVersion,
    watermarkAt: source.watermarkAt,
    consecutiveFailures: 0,
  };
}

test("degradation refuses to mutate a source without an owned lease", async () => {
  const { evaluateAndApplyDegradation } = await import("@/lib/scraper/incremental/observability-query");

  const outcome = await evaluateAndApplyDegradation({
    source: driftSource(null),
    zeroDiscoveryStreak: 100,
    now: NOW,
  });
  assert.equal(outcome.demoted, false);
  assert.equal(outcome.reason, "zero-discovery-drift");
});

test("degradation reports a guarded transition refusal", async () => {
  const { evaluateAndApplyDegradation } = await import("@/lib/scraper/incremental/observability-query");

  const outcome = await evaluateAndApplyDegradation({
    source: driftSource("worker-observability"),
    zeroDiscoveryStreak: 100,
    now: NOW,
    applyTransition: async () => ({ committed: false, reason: "lease-lost" }),
  });
  assert.equal(outcome.demoted, false);
});

test("degradation persistence failures are isolated from the discovery run", async () => {
  const { evaluateAndApplyDegradation } = await import("@/lib/scraper/incremental/observability-query");

  const outcome = await evaluateAndApplyDegradation({
    source: driftSource("worker-observability"),
    zeroDiscoveryStreak: 100,
    now: NOW,
    applyTransition: async () => {
      throw new Error("database unavailable");
    },
  });
  assert.equal(outcome.demoted, false);
});
