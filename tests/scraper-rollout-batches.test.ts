/**
 * Pure unit tests for the Phase-2.8 rollout batch / tier configuration
 * (issue #1098).
 *
 * `rollout-batches.ts` is DATA-ONLY. These tests prove:
 *   - the batches are strictly ordered and the FIRST batch is the three canaries;
 *   - batches are grouped by strategy/risk (RSS vs sitemap vs seed-HTML) and the
 *     per-day / concurrency limits ramp up across tiers;
 *   - the tier-limit lookup helper resolves a member and returns null otherwise;
 *   - NO member auto-activates (registry sync can never activate a source) — the
 *     baseline-required guard, and NO authenticated provider is ever a member —
 *     the auth-excluded guard.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import { CANARIES } from "@/lib/scraper/incremental/canaries";
import {
  ROLLOUT_BATCHES,
  assertBatchesOrdered,
  assertNoAuthenticatedProviderInBatch,
  assertNoBatchSkipsBaseline,
  findRolloutBatchForSource,
  tierLimitsForSource,
  type RolloutBatch,
} from "@/lib/scraper/incremental/rollout-batches";

test("batches are a gap-free ascending sequence and the first is the canaries", () => {
  assert.ok(ROLLOUT_BATCHES.length >= 1);
  assert.doesNotThrow(() => assertBatchesOrdered());
  assert.equal(ROLLOUT_BATCHES[0].id, "tier-0-canaries");
  assert.equal(ROLLOUT_BATCHES[0].riskClass, "canary");
  // The first batch is exactly the three Phase-1 canaries (one per channel).
  const firstKeys = ROLLOUT_BATCHES[0].members
    .map((m) => `${m.providerKey}/${m.sourceKey}`)
    .sort();
  const canaryKeys = CANARIES.map((c) => `${c.providerKey}/${c.sourceKey}`).sort();
  assert.deepEqual(firstKeys, canaryKeys);
});

test("expansion batches are grouped by a single channel / risk class", () => {
  const expansion = ROLLOUT_BATCHES.filter((b) => b.riskClass !== "canary");
  const riskClasses = expansion.map((b) => b.riskClass).sort();
  assert.deepEqual(riskClasses, ["rss", "seed-html", "sitemap"]);
  for (const batch of expansion) {
    assert.equal(batch.channels.length, 1, `${batch.id} must isolate one channel`);
  }
});

test("per-day body-ingestion limits ramp up across tiers", () => {
  const limits = ROLLOUT_BATCHES.map((b) => b.limits.maxBodyIngestPerDay);
  for (let i = 1; i < limits.length; i += 1) {
    assert.ok(limits[i] > limits[i - 1], `tier ${i} must ramp above tier ${i - 1}`);
  }
  // The canary tier carries the lowest cap (the proving set).
  assert.equal(Math.min(...limits), ROLLOUT_BATCHES[0].limits.maxBodyIngestPerDay);
});

test("tierLimitsForSource resolves a canary member and returns null for a non-member", () => {
  const canary = CANARIES[0];
  const limits = tierLimitsForSource(canary.providerKey, canary.sourceKey);
  assert.ok(limits, "expected a canary member to resolve to tier limits");
  assert.equal(limits, ROLLOUT_BATCHES[0].limits);
  assert.equal(tierLimitsForSource("not-a-provider", "not-a-source"), null);

  const batch = findRolloutBatchForSource(canary.providerKey, canary.sourceKey);
  assert.equal(batch?.id, "tier-0-canaries");
});

test("assertNoBatchSkipsBaseline: real config passes; an auto-activating member throws", () => {
  assert.doesNotThrow(() => assertNoBatchSkipsBaseline());
  const offending: RolloutBatch[] = [
    {
      order: 0,
      id: "bad-batch",
      riskClass: "rss",
      channels: ["rss"],
      limits: { maxBodyIngestPerDay: 1, maxDownstreamJobsPerDay: 1, maxConcurrentSources: 1 },
      // deliberately force the invariant violation the type system forbids
      members: [
        {
          providerKey: "p",
          sourceKey: "s",
          channel: "rss",
          autoActivate: true as unknown as false,
          requiresAuth: false,
        },
      ],
      rationale: "test",
    },
  ];
  assert.throws(() => assertNoBatchSkipsBaseline(offending), /must not auto-activate/);
});

test("assertNoAuthenticatedProviderInBatch: real config passes; a requiresAuth member throws", () => {
  assert.doesNotThrow(() => assertNoAuthenticatedProviderInBatch());
  const offending: RolloutBatch[] = [
    {
      order: 0,
      id: "bad-batch",
      riskClass: "rss",
      channels: ["rss"],
      limits: { maxBodyIngestPerDay: 1, maxDownstreamJobsPerDay: 1, maxConcurrentSources: 1 },
      members: [
        {
          providerKey: "p",
          sourceKey: "s",
          channel: "rss",
          autoActivate: false,
          requiresAuth: true as unknown as false,
        },
      ],
      rationale: "test",
    },
  ];
  assert.throws(() => assertNoAuthenticatedProviderInBatch(offending), /exclude authenticated providers/);
});

test("assertNoAuthenticatedProviderInBatch cross-checks a known authenticated provider set", () => {
  // Even with a well-formed member, a provider key in the authenticated set is rejected.
  const canary = CANARIES[0];
  const authKeys = new Set([canary.providerKey]);
  assert.throws(
    () => assertNoAuthenticatedProviderInBatch(ROLLOUT_BATCHES, authKeys),
    /exclude authenticated providers/,
  );
  // An unrelated authenticated set does not affect the public config.
  assert.doesNotThrow(() =>
    assertNoAuthenticatedProviderInBatch(ROLLOUT_BATCHES, new Set(["some-authed-provider"])),
  );
});

test("assertBatchesOrdered throws on an out-of-sequence ordinal", () => {
  const misordered: RolloutBatch[] = [
    { ...ROLLOUT_BATCHES[0], order: 1 },
  ];
  assert.throws(() => assertBatchesOrdered(misordered), /gap-free ascending/);
});
