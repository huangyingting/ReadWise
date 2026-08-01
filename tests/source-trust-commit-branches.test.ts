/** Guard-classification and failure-isolation coverage for source trust commits. */
process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

import { DiscoverySourceLifecycleMode } from "@prisma/client";

let snapshot: Record<string, unknown> | null = null;
let updateCount = 1;
let updateError: Error | null = null;
let fresh: Record<string, unknown> | null = null;
let transitionResult: Record<string, unknown> = { committed: true };

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        discoverySource: {
          updateMany: async () => {
            if (updateError) throw updateError;
            return { count: updateCount };
          },
          findUnique: async () => fresh,
        },
      },
    },
  });
  mock.module("@/lib/scraper/incremental/source-trust-query", {
    namedExports: {
      getSourceTrustSnapshot: async () => snapshot,
    },
  });
  mock.module("@/lib/scraper/incremental/lifecycle-commit", {
    namedExports: {
      transitionDiscoveryLifecycle: async () => transitionResult,
    },
  });
});

beforeEach(() => {
  snapshot = trustSnapshot(false);
  updateCount = 1;
  updateError = null;
  fresh = null;
  transitionResult = { committed: true };
});

const NOW = new Date("2026-07-31T19:00:00.000Z");

function trustSnapshot(trusted: boolean, definitionVersion = 1) {
  const evidence = {
    sampleSize: 25,
    acceptedCount: 20,
    reviewRejectedCount: 5,
    decidedCount: 25,
    approvalRate: 0.8,
    oldItemFalsePositives: 0,
    oldItemFalsePositiveRate: 0,
    drift: {
      zeroDiscoveryStreak: 0,
      consecutiveFailures: 0,
      volumeAnomaly: "normal",
      conflictRate: 0,
      oldItemFalsePositives: 0,
    },
  };
  return {
    id: "source-trust-branches",
    providerKey: "provider-trust-branches",
    sourceKey: "primary",
    definitionVersion,
    lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
    policy: {
      autoPublishTrusted: trusted,
      canRepublishPublicly: true,
      canFetchAuthenticated: false,
    },
    evidence,
    eligibility: { eligible: true, blockers: [], warnings: [], evidence },
  };
}

test("manual trust actions report missing snapshots and demote version mismatch", async () => {
  const { demoteSourceTrust, promoteSourceTrust } = await import("@/lib/scraper/incremental/source-trust-commit");
  snapshot = null;
  assert.deepEqual(await promoteSourceTrust({ sourceId: "missing", definitionVersion: 1, now: NOW }), {
    ok: false,
    action: "promote",
    sourceId: "missing",
    reason: "source-not-found",
  });
  assert.deepEqual(await demoteSourceTrust({ sourceId: "missing", definitionVersion: 1, now: NOW }), {
    ok: false,
    action: "demote",
    sourceId: "missing",
    reason: "source-not-found",
  });

  snapshot = trustSnapshot(true, 2);
  const mismatch = await demoteSourceTrust({ sourceId: "source-trust-branches", definitionVersion: 1, now: NOW });
  assert.equal(mismatch.ok, false);
  assert.equal(!mismatch.ok && mismatch.reason, "version-mismatch");
});

test("a raced promotion to trusted resolves to an idempotent no-op", async () => {
  const { promoteSourceTrust } = await import("@/lib/scraper/incremental/source-trust-commit");
  updateCount = 0;
  fresh = { leaseOwner: null, definitionVersion: 1, autoPublishTrusted: true };

  const outcome = await promoteSourceTrust({ sourceId: "source-trust-branches", definitionVersion: 1, now: NOW });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.ok && outcome.changed, false);
  assert.equal(outcome.ok && outcome.after.autoPublishTrusted, true);
});

for (const [label, freshRow, expected] of [
  ["missing", null, "source-not-found"],
  ["re-versioned", { leaseOwner: null, definitionVersion: 2, autoPublishTrusted: false }, "version-mismatch"],
  ["busy", { leaseOwner: "other-worker", definitionVersion: 1, autoPublishTrusted: false }, "busy"],
  ["stale", { leaseOwner: null, definitionVersion: 1, autoPublishTrusted: false }, "stale"],
] as const) {
  test(`a ${label} promotion guard is classified as ${expected}`, async () => {
    const { promoteSourceTrust } = await import("@/lib/scraper/incremental/source-trust-commit");
    updateCount = 0;
    fresh = freshRow;

    const outcome = await promoteSourceTrust({ sourceId: "source-trust-branches", definitionVersion: 1, now: NOW });
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.reason, expected);
  });
}

test("a raced demotion to untrusted resolves to an idempotent no-op", async () => {
  const { demoteSourceTrust } = await import("@/lib/scraper/incremental/source-trust-commit");
  snapshot = trustSnapshot(true);
  updateCount = 0;
  fresh = { leaseOwner: null, definitionVersion: 1, autoPublishTrusted: false };

  const outcome = await demoteSourceTrust({ sourceId: "source-trust-branches", definitionVersion: 1, now: NOW });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.ok && outcome.changed, false);
});

test("a failed demotion guard returns its controlled reason", async () => {
  const { demoteSourceTrust } = await import("@/lib/scraper/incremental/source-trust-commit");
  snapshot = trustSnapshot(true);
  updateCount = 0;
  fresh = null;

  const outcome = await demoteSourceTrust({ sourceId: "source-trust-branches", definitionVersion: 1, now: NOW });
  assert.equal(outcome.ok, false);
  assert.equal(!outcome.ok && outcome.reason, "source-not-found");
});

function driftSource() {
  return {
    id: "source-trust-branches",
    autoPublishTrusted: true,
    leaseOwner: "worker-trust-branches",
    definitionVersion: 1,
    lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
  } as never;
}

function driftSnapshot(trusted = true) {
  const value = trustSnapshot(trusted);
  value.evidence.drift.oldItemFalsePositives = 1;
  value.evidence.oldItemFalsePositives = 1;
  return value;
}

test("auto-demotion stops when the persisted trust snapshot vanished", async () => {
  const { evaluateAndApplyTrustDemotion } = await import("@/lib/scraper/incremental/source-trust-commit");
  snapshot = null;

  assert.deepEqual(await evaluateAndApplyTrustDemotion({ source: driftSource(), zeroDiscoveryStreak: 0, now: NOW }), {
    demoted: false,
    reasons: [],
  });
});

test("auto-demotion reports a guard refusal without changing lifecycle", async () => {
  const { evaluateAndApplyTrustDemotion } = await import("@/lib/scraper/incremental/source-trust-commit");
  snapshot = driftSnapshot();
  updateCount = 0;
  fresh = { leaseOwner: "worker-trust-branches", definitionVersion: 1, autoPublishTrusted: false };

  const outcome = await evaluateAndApplyTrustDemotion({ source: driftSource(), zeroDiscoveryStreak: 0, now: NOW });
  assert.equal(outcome.demoted, false);
  assert.ok(outcome.reasons.includes("old-item-false-positive"));
});

test("auto-demotion remains successful when the shadow roll loses its guard", async () => {
  const { evaluateAndApplyTrustDemotion } = await import("@/lib/scraper/incremental/source-trust-commit");
  snapshot = driftSnapshot();
  transitionResult = { committed: false, reason: "lease-lost" };

  const outcome = await evaluateAndApplyTrustDemotion({ source: driftSource(), zeroDiscoveryStreak: 0, now: NOW });
  assert.equal(outcome.demoted, true, "the trust flag was already revoked");
});

test("auto-demotion persistence failures are isolated from discovery", async () => {
  const { evaluateAndApplyTrustDemotion } = await import("@/lib/scraper/incremental/source-trust-commit");
  snapshot = driftSnapshot();
  updateError = new Error("database unavailable");

  const outcome = await evaluateAndApplyTrustDemotion({ source: driftSource(), zeroDiscoveryStreak: 0, now: NOW });
  assert.equal(outcome.demoted, false);
  assert.ok(outcome.reasons.includes("old-item-false-positive"));
});
