/**
 * Pure unit tests for the source-trust promotion/demotion policy (issue #1100).
 *
 * `source-trust-policy.ts` is PURE — no DB/network/clock. These tests prove:
 *   - the evidence rollup (sample size, approval rate, old-item FP rate);
 *   - promotion eligibility is a REPORT (never an action) with hard blockers +
 *     soft warnings, and an old-item false positive is a hard, zero-tolerance
 *     blocker (the governing invariant);
 *   - drift auto-demotion fires on each configured anomaly and records EVERY
 *     triggering reason, and never fires on an untrusted source.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import { CrawlCandidateStatus } from "@prisma/client";

import {
  computeSourceTrustEvidence,
  decideSourceTrustDemotion,
  decideSourceTrustEligibility,
  type SourceTrustDriftSignals,
} from "@/lib/scraper/incremental/source-trust-policy";
import type { CandidateStatusCounts } from "@/lib/scraper/incremental/observability";

const S = CrawlCandidateStatus;

function drift(overrides: Partial<SourceTrustDriftSignals> = {}): SourceTrustDriftSignals {
  return {
    zeroDiscoveryStreak: 0,
    consecutiveFailures: 0,
    volumeAnomaly: "none",
    conflictRate: 0,
    oldItemFalsePositives: 0,
    ...overrides,
  };
}

/** A clean, comfortably-eligible candidate mix (25 total, 20 decided, 90% approved). */
function cleanCounts(): CandidateStatusCounts {
  return { [S.INGESTED]: 18, [S.SKIPPED_REVIEW]: 2, [S.DISCOVERED]: 5 };
}

// ---- evidence -------------------------------------------------------------

test("evidence rolls up sample size, accepted/rejected, approval + FP rates", () => {
  const e = computeSourceTrustEvidence({
    candidateCounts: { [S.INGESTED]: 6, [S.INGESTING]: 1, [S.QUEUED]: 1, [S.SKIPPED_REVIEW]: 2, [S.DISCOVERED]: 4 },
    drift: drift({ oldItemFalsePositives: 0 }),
  });
  assert.equal(e.sampleSize, 14);
  assert.equal(e.acceptedCount, 8); // 6 + 1 + 1
  assert.equal(e.reviewRejectedCount, 2);
  assert.equal(e.decidedCount, 10);
  assert.equal(e.approvalRate, 0.8);
  assert.equal(e.oldItemFalsePositiveRate, 0);
});

test("approval rate is null before any decision exists", () => {
  const e = computeSourceTrustEvidence({ candidateCounts: { [S.DISCOVERED]: 3 }, drift: drift() });
  assert.equal(e.decidedCount, 0);
  assert.equal(e.approvalRate, null);
  assert.equal(e.oldItemFalsePositiveRate, null);
});

// ---- eligibility (report only) -------------------------------------------

test("a clean, well-sampled source is reported eligible with no blockers", () => {
  const e = computeSourceTrustEvidence({ candidateCounts: cleanCounts(), drift: drift() });
  const r = decideSourceTrustEligibility(e);
  assert.equal(r.eligible, true);
  assert.deepEqual(r.blockers, []);
});

test("an old-item false positive is a hard, zero-tolerance blocker", () => {
  const e = computeSourceTrustEvidence({ candidateCounts: cleanCounts(), drift: drift({ oldItemFalsePositives: 1 }) });
  const r = decideSourceTrustEligibility(e);
  assert.equal(r.eligible, false);
  assert.ok(r.blockers.includes("old-item-false-positive"));
});

test("insufficient sample + decisions block promotion", () => {
  const e = computeSourceTrustEvidence({ candidateCounts: { [S.INGESTED]: 4, [S.SKIPPED_REVIEW]: 1 }, drift: drift() });
  const r = decideSourceTrustEligibility(e);
  assert.equal(r.eligible, false);
  assert.ok(r.blockers.includes("insufficient-sample"));
  assert.ok(r.blockers.includes("insufficient-decisions"));
});

test("a low approval rate blocks promotion once sample + decisions suffice", () => {
  // 22 total, 12 decided (7 accepted / 5 rejected ⇒ 0.58), no drift.
  const e = computeSourceTrustEvidence({
    candidateCounts: { [S.INGESTED]: 7, [S.SKIPPED_REVIEW]: 5, [S.DISCOVERED]: 10 },
    drift: drift(),
  });
  const r = decideSourceTrustEligibility(e);
  assert.equal(r.eligible, false);
  assert.ok(r.blockers.includes("low-approval-rate"));
  assert.equal(r.blockers.includes("insufficient-sample"), false);
  assert.equal(r.blockers.includes("insufficient-decisions"), false);
});

test("active drift blocks promotion and surfaces a warning", () => {
  const e = computeSourceTrustEvidence({ candidateCounts: cleanCounts(), drift: drift({ zeroDiscoveryStreak: 5 }) });
  const r = decideSourceTrustEligibility(e);
  assert.equal(r.eligible, false);
  assert.ok(r.blockers.includes("active-drift"));
});

test("a volume anomaly is both an active-drift blocker and a soft warning", () => {
  const e = computeSourceTrustEvidence({ candidateCounts: cleanCounts(), drift: drift({ volumeAnomaly: "drop" }) });
  const r = decideSourceTrustEligibility(e);
  assert.equal(r.eligible, false);
  assert.ok(r.blockers.includes("active-drift"));
  assert.ok(r.warnings.includes("volume-anomaly"));
});

// ---- drift auto-demotion --------------------------------------------------

test("an untrusted source is never auto-demoted (nothing to revoke)", () => {
  const d = decideSourceTrustDemotion({ isTrusted: false, drift: drift({ oldItemFalsePositives: 5 }) });
  assert.equal(d.action, "keep");
  assert.deepEqual(d.reasons, []);
});

test("a trusted, clean source is kept", () => {
  const d = decideSourceTrustDemotion({ isTrusted: true, drift: drift() });
  assert.equal(d.action, "keep");
});

test("each configured anomaly auto-demotes a trusted source", () => {
  const cases: Array<[Partial<SourceTrustDriftSignals>, string]> = [
    [{ oldItemFalsePositives: 1 }, "old-item-false-positive"],
    [{ zeroDiscoveryStreak: 8 }, "zero-discovery-drift"],
    [{ consecutiveFailures: 3 }, "repeated-failures"],
    [{ volumeAnomaly: "spike" }, "volume-anomaly"],
    [{ conflictRate: 0.3 }, "elevated-conflict-rate"],
  ];
  for (const [override, reason] of cases) {
    const d = decideSourceTrustDemotion({ isTrusted: true, drift: drift(override) });
    assert.equal(d.action, "demote", `expected demote for ${reason}`);
    assert.ok(d.reasons.includes(reason as never), `expected reason ${reason}`);
  }
});

test("demotion records EVERY triggering reason for the audit evidence", () => {
  const d = decideSourceTrustDemotion({
    isTrusted: true,
    drift: drift({ oldItemFalsePositives: 2, zeroDiscoveryStreak: 9, consecutiveFailures: 4 }),
  });
  assert.equal(d.action, "demote");
  assert.deepEqual(
    [...d.reasons].sort(),
    ["old-item-false-positive", "repeated-failures", "zero-discovery-drift"],
  );
});
