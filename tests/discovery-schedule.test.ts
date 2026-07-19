/**
 * Pure scheduler-clock tests for leased discovery scheduling (issue #1087).
 *
 * Table-driven and fully deterministic (no real clock, DB, or randomness):
 * exercises cadence bounds, each role tier, backoff escalation, pause,
 * fallback activation, budget exhaustion, and auto-claim eligibility.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DiscoveryAutomationPolicy,
  DiscoverySourceLifecycleMode,
  DiscoverySourceRole,
} from "@prisma/client";

import {
  computeNextRunAt,
  failureBackoffSeconds,
  isAutoClaimEligible,
  roleTier,
  BASE_BACKOFF_SECONDS,
  DEFAULT_BUDGET_COOLDOWN_SECONDS,
  DEFAULT_PRIMARY_INTERVAL_SECONDS,
  DEFAULT_SUPPLEMENTAL_INTERVAL_SECONDS,
  MAX_BACKOFF_SECONDS,
  SUPPLEMENTAL_FREQUENCY_MULTIPLIER,
  type ComputeNextRunAtInput,
} from "@/lib/scraper/incremental/schedule";

const NOW = new Date("2026-07-19T08:00:00.000Z");

function base(overrides: Partial<ComputeNextRunAtInput> = {}): ComputeNextRunAtInput {
  return {
    now: NOW,
    role: DiscoverySourceRole.PRIMARY_FEED,
    automationPolicy: DiscoveryAutomationPolicy.SCHEDULED,
    lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
    ...overrides,
  };
}

/** Seconds between NOW and a computed nextRunAt. */
function secondsFromNow(date: Date | null): number | null {
  return date === null ? null : Math.round((date.getTime() - NOW.getTime()) / 1000);
}

test("roleTier maps supplemental apart from every primary-tier role", () => {
  assert.equal(roleTier(DiscoverySourceRole.PRIMARY_FEED), "primary");
  assert.equal(roleTier(DiscoverySourceRole.SECTION_INDEX), "primary");
  assert.equal(roleTier(DiscoverySourceRole.ARCHIVE_INDEX), "primary");
  assert.equal(roleTier(DiscoverySourceRole.SITEMAP), "primary");
  assert.equal(roleTier(DiscoverySourceRole.SUPPLEMENTAL), "supplemental");
});

test("failureBackoffSeconds is a capped, jitter-free exponential", () => {
  assert.equal(failureBackoffSeconds(0), 0);
  assert.equal(failureBackoffSeconds(1), BASE_BACKOFF_SECONDS);
  assert.equal(failureBackoffSeconds(2), BASE_BACKOFF_SECONDS * 2);
  assert.equal(failureBackoffSeconds(3), BASE_BACKOFF_SECONDS * 4);
  assert.equal(failureBackoffSeconds(100), MAX_BACKOFF_SECONDS);
});

const cases: Array<{ name: string; input: ComputeNextRunAtInput; expectSeconds: number | null }> = [
  {
    name: "primary uses the tier default cadence with no explicit interval",
    input: base(),
    expectSeconds: DEFAULT_PRIMARY_INTERVAL_SECONDS,
  },
  {
    name: "primary honors an explicit pollIntervalSeconds",
    input: base({ pollIntervalSeconds: 3600 }),
    expectSeconds: 3600,
  },
  {
    name: "supplemental uses a stretched tier default (lower frequency)",
    input: base({ role: DiscoverySourceRole.SUPPLEMENTAL }),
    expectSeconds: DEFAULT_SUPPLEMENTAL_INTERVAL_SECONDS * SUPPLEMENTAL_FREQUENCY_MULTIPLIER,
  },
  {
    name: "supplemental stretches an explicit interval by the multiplier",
    input: base({ role: DiscoverySourceRole.SUPPLEMENTAL, pollIntervalSeconds: 3600 }),
    expectSeconds: 3600 * SUPPLEMENTAL_FREQUENCY_MULTIPLIER,
  },
  {
    name: "backoff dominates the cadence once it exceeds it",
    input: base({ pollIntervalSeconds: 60, backoffLevel: 6 }),
    expectSeconds: failureBackoffSeconds(6),
  },
  {
    name: "a small backoff never shortens the base cadence",
    input: base({ pollIntervalSeconds: 3600, backoffLevel: 1 }),
    expectSeconds: 3600,
  },
  {
    name: "budget exhaustion defers by at least the cooldown",
    input: base({ pollIntervalSeconds: 60, budgetExhausted: true }),
    expectSeconds: DEFAULT_BUDGET_COOLDOWN_SECONDS,
  },
  {
    name: "cadence bounds clamp a too-fast interval up to the minimum",
    input: base({ pollIntervalSeconds: 60, cadenceBounds: { minIntervalSeconds: 1800 } }),
    expectSeconds: 1800,
  },
  {
    name: "cadence bounds clamp a too-slow interval down to the maximum",
    input: base({ pollIntervalSeconds: 86400, cadenceBounds: { maxIntervalSeconds: 3600 } }),
    expectSeconds: 3600,
  },
  {
    name: "paused source is never due",
    input: base({ paused: true }),
    expectSeconds: null,
  },
  {
    name: "MANUAL automation policy is not auto-claim-eligible",
    input: base({ automationPolicy: DiscoveryAutomationPolicy.MANUAL }),
    expectSeconds: null,
  },
  {
    name: "DISABLED lifecycle is not auto-claim-eligible",
    input: base({ lifecycleMode: DiscoverySourceLifecycleMode.DISABLED }),
    expectSeconds: null,
  },
  {
    name: "PAUSED lifecycle is not auto-claim-eligible",
    input: base({ lifecycleMode: DiscoverySourceLifecycleMode.PAUSED }),
    expectSeconds: null,
  },
  {
    name: "SHADOW lifecycle is scheduled (claimed, but body work is blocked elsewhere)",
    input: base({ lifecycleMode: DiscoverySourceLifecycleMode.SHADOW }),
    expectSeconds: DEFAULT_PRIMARY_INTERVAL_SECONDS,
  },
  {
    name: "designated fallback stays dormant until activated",
    input: base({ fallback: { designated: true, activated: false } }),
    expectSeconds: null,
  },
  {
    name: "activated fallback runs on its cadence",
    input: base({ fallback: { designated: true, activated: true } }),
    expectSeconds: DEFAULT_PRIMARY_INTERVAL_SECONDS,
  },
];

for (const { name, input, expectSeconds } of cases) {
  test(`computeNextRunAt: ${name}`, () => {
    assert.equal(secondsFromNow(computeNextRunAt(input)), expectSeconds);
  });
}

test("isAutoClaimEligible requires an auto policy AND a claimable lifecycle mode", () => {
  assert.equal(
    isAutoClaimEligible({
      automationPolicy: DiscoveryAutomationPolicy.CONTINUOUS,
      lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
    }),
    true,
  );
  assert.equal(
    isAutoClaimEligible({
      automationPolicy: DiscoveryAutomationPolicy.MANUAL,
      lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
    }),
    false,
  );
  assert.equal(
    isAutoClaimEligible({
      automationPolicy: DiscoveryAutomationPolicy.SCHEDULED,
      lifecycleMode: DiscoverySourceLifecycleMode.RETIRED,
    }),
    false,
  );
});
