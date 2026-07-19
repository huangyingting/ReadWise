/**
 * Pure unit tests for the Phase-2.8 measured-rollout gate evaluator + activation
 * acceptance matrix (issue #1098).
 *
 * `rollout-gates.ts` is PURE — no DB/network/clock. These tests prove:
 *   - every gate passes on a clean snapshot and fails on its own violation;
 *   - the correctness (BLOCKING) gates are HARD ZEROS;
 *   - the advisory threshold boundaries (inclusive `<=`) behave correctly;
 *   - the overall go/no-go verdict is `go` only when EVERY gate passes, and
 *     blocking vs advisory failures are surfaced separately;
 *   - the activation acceptance matrix is FAIL-CLOSED when evidence is absent.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import { DiscoverySourceHealth } from "@prisma/client";

import {
  ACTIVATION_REQUIREMENTS,
  MAX_DISCOVERY_LAG_SECONDS,
  MAX_DISCOVERY_RUN_AGE_SECONDS,
  MAX_QUARANTINE_RATE,
  MAX_QUEUE_AGE_SECONDS,
  MAX_QUEUE_DEPTH,
  MAX_RETRY_RATE,
  ROLLOUT_GATES,
  ROLLOUT_GATE_SEVERITY,
  evaluateActivationReadiness,
  evaluateRolloutGates,
  type ActivationReadiness,
  type RolloutGateSnapshot,
} from "@/lib/scraper/incremental/rollout-gates";
import type { SourceMetricSummary } from "@/lib/scraper/incremental/observability";
import { emptyReconciliation, reconcile } from "@/lib/scraper/incremental/reconciliation";

/** A minimal passing metric summary (only the fields the gates read matter). */
function metrics(overrides: Partial<SourceMetricSummary> = {}): SourceMetricSummary {
  return {
    health: DiscoverySourceHealth.HEALTHY,
    lastRunAgeSeconds: 60 * 60, // 1h ago — fresh
    publicationToDiscoveryDelay: { p50Seconds: 100, p90Seconds: 3600, maxSeconds: 7200, sampleCount: 20 },
    volumeAnomaly: "none",
    discoveryBudgetPerRun: 200,
    discoveryBudgetExhausted: false,
    bodyBudgetExhausted: false,
    aiBudgetExhausted: false,
    hostPauseActive: false,
    hostConsecutiveErrors: 0,
    ...overrides,
  } as unknown as SourceMetricSummary;
}

/** A fully-passing rollout snapshot: every gate green. */
function passingSnapshot(overrides: Partial<RolloutGateSnapshot> = {}): RolloutGateSnapshot {
  return {
    metrics: metrics(),
    reconciliation: emptyReconciliation(),
    oldItemFalsePositives: 0,
    duplicateWork: 0,
    queueDepth: 10,
    queueOldestAgeSeconds: 120,
    ingestAttempts: 100,
    retriedJobs: 2,
    quarantinedItems: 1,
    discoveredPerRun: 20,
    bodyIngestedPerDay: 10,
    bodyIngestBudgetPerDay: 25,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy path + gate set
// ---------------------------------------------------------------------------

test("all gates pass (go) on a clean snapshot", () => {
  const verdict = evaluateRolloutGates(passingSnapshot());
  assert.equal(verdict.verdict, "go");
  assert.deepEqual(verdict.failing, []);
  assert.deepEqual(verdict.blockingFailures, []);
  assert.deepEqual(verdict.advisoryFailures, []);
  assert.deepEqual(
    verdict.gates.map((g) => g.gate).sort(),
    [...ROLLOUT_GATES].sort(),
  );
  assert.ok(verdict.gates.every((g) => g.passed));
});

test("every gate carries its declared severity in the result", () => {
  const verdict = evaluateRolloutGates(passingSnapshot());
  for (const g of verdict.gates) {
    assert.equal(g.severity, ROLLOUT_GATE_SEVERITY[g.gate]);
  }
});

// ---------------------------------------------------------------------------
// BLOCKING correctness gates — hard zeros
// ---------------------------------------------------------------------------

test("no-old-item-false-positives is a hard zero (1 → hold, blocking)", () => {
  const verdict = evaluateRolloutGates(passingSnapshot({ oldItemFalsePositives: 1 }));
  assert.equal(verdict.verdict, "hold");
  assert.deepEqual(verdict.failing, ["no-old-item-false-positives"]);
  assert.deepEqual(verdict.blockingFailures, ["no-old-item-false-positives"]);
  assert.deepEqual(verdict.advisoryFailures, []);
});

test("no-duplicate-work is a hard zero (1 → hold, blocking)", () => {
  const verdict = evaluateRolloutGates(passingSnapshot({ duplicateWork: 1 }));
  assert.equal(verdict.verdict, "hold");
  assert.deepEqual(verdict.blockingFailures, ["no-duplicate-work"]);
});

test("no-unexplained-gaps is a hard zero (reconciliation miss → hold, blocking)", () => {
  const reconciliation = reconcile(
    [{ identityKey: "v1:aaa", expectedObservable: true }],
    [],
  );
  const verdict = evaluateRolloutGates(passingSnapshot({ reconciliation }));
  assert.equal(verdict.verdict, "hold");
  assert.deepEqual(verdict.blockingFailures, ["no-unexplained-gaps"]);
});

// ---------------------------------------------------------------------------
// ADVISORY gates + threshold boundaries (inclusive <=)
// ---------------------------------------------------------------------------

test("discovery-latency passes exactly at the lag + run-age boundaries", () => {
  const boundary = passingSnapshot({
    metrics: metrics({
      publicationToDiscoveryDelay: { p50Seconds: 1, p90Seconds: MAX_DISCOVERY_LAG_SECONDS, maxSeconds: MAX_DISCOVERY_LAG_SECONDS, sampleCount: 5 },
      lastRunAgeSeconds: MAX_DISCOVERY_RUN_AGE_SECONDS,
    }),
  });
  assert.equal(evaluateRolloutGates(boundary).verdict, "go");
});

test("discovery-latency holds one second past the lag boundary (advisory)", () => {
  const overLag = passingSnapshot({
    metrics: metrics({
      publicationToDiscoveryDelay: { p50Seconds: 1, p90Seconds: MAX_DISCOVERY_LAG_SECONDS + 1, maxSeconds: MAX_DISCOVERY_LAG_SECONDS + 1, sampleCount: 5 },
    }),
  });
  const verdict = evaluateRolloutGates(overLag);
  assert.equal(verdict.verdict, "hold");
  assert.deepEqual(verdict.advisoryFailures, ["discovery-latency"]);
  assert.deepEqual(verdict.blockingFailures, []);
});

test("discovery-latency fails closed when the source has never run", () => {
  const neverRan = passingSnapshot({ metrics: metrics({ lastRunAgeSeconds: null }) });
  assert.deepEqual(evaluateRolloutGates(neverRan).advisoryFailures, ["discovery-latency"]);
});

test("discovery-latency passes with no delay sample (null p90) but a fresh run", () => {
  const noSample = passingSnapshot({ metrics: metrics({ publicationToDiscoveryDelay: null }) });
  assert.equal(evaluateRolloutGates(noSample).verdict, "go");
});

test("queue-health passes at the depth + age boundaries, holds one past either", () => {
  assert.equal(
    evaluateRolloutGates(
      passingSnapshot({ queueDepth: MAX_QUEUE_DEPTH, queueOldestAgeSeconds: MAX_QUEUE_AGE_SECONDS }),
    ).verdict,
    "go",
  );
  assert.deepEqual(
    evaluateRolloutGates(passingSnapshot({ queueDepth: MAX_QUEUE_DEPTH + 1 })).advisoryFailures,
    ["queue-health"],
  );
  assert.deepEqual(
    evaluateRolloutGates(passingSnapshot({ queueOldestAgeSeconds: MAX_QUEUE_AGE_SECONDS + 1 })).advisoryFailures,
    ["queue-health"],
  );
});

test("retry-quarantine-rate passes at the boundary and holds just past it", () => {
  const attempts = 1000;
  const atBoundary = passingSnapshot({
    ingestAttempts: attempts,
    retriedJobs: Math.round(MAX_RETRY_RATE * attempts),
    quarantinedItems: Math.round(MAX_QUARANTINE_RATE * attempts),
  });
  assert.equal(evaluateRolloutGates(atBoundary).verdict, "go");

  const overRetry = passingSnapshot({
    ingestAttempts: attempts,
    retriedJobs: Math.round(MAX_RETRY_RATE * attempts) + 1,
    quarantinedItems: 0,
  });
  assert.deepEqual(evaluateRolloutGates(overRetry).advisoryFailures, ["retry-quarantine-rate"]);

  const overQuarantine = passingSnapshot({
    ingestAttempts: attempts,
    retriedJobs: 0,
    quarantinedItems: Math.round(MAX_QUARANTINE_RATE * attempts) + 1,
  });
  assert.deepEqual(evaluateRolloutGates(overQuarantine).advisoryFailures, ["retry-quarantine-rate"]);
});

test("retry-quarantine-rate passes with zero attempts (0/0 → 0 rate)", () => {
  const idle = passingSnapshot({ ingestAttempts: 0, retriedJobs: 0, quarantinedItems: 0 });
  assert.equal(evaluateRolloutGates(idle).verdict, "go");
});

test("provider-http-health holds on DEGRADED/FAILING/BLOCKED and on an active host pause", () => {
  for (const health of [DiscoverySourceHealth.DEGRADED, DiscoverySourceHealth.FAILING, DiscoverySourceHealth.BLOCKED]) {
    assert.deepEqual(
      evaluateRolloutGates(passingSnapshot({ metrics: metrics({ health }) })).advisoryFailures,
      ["provider-http-health"],
    );
  }
  assert.deepEqual(
    evaluateRolloutGates(passingSnapshot({ metrics: metrics({ hostPauseActive: true }) })).advisoryFailures,
    ["provider-http-health"],
  );
});

test("provider-http-health passes on HEALTHY and UNKNOWN", () => {
  assert.equal(evaluateRolloutGates(passingSnapshot({ metrics: metrics({ health: DiscoverySourceHealth.HEALTHY }) })).verdict, "go");
  assert.equal(evaluateRolloutGates(passingSnapshot({ metrics: metrics({ health: DiscoverySourceHealth.UNKNOWN }) })).verdict, "go");
});

test("cost-budget holds on per-run over, per-day over, exhaustion, or a spike", () => {
  assert.deepEqual(
    evaluateRolloutGates(passingSnapshot({ discoveredPerRun: 201 })).advisoryFailures,
    ["cost-budget"],
  );
  assert.deepEqual(
    evaluateRolloutGates(passingSnapshot({ bodyIngestedPerDay: 26, bodyIngestBudgetPerDay: 25 })).advisoryFailures,
    ["cost-budget"],
  );
  assert.deepEqual(
    evaluateRolloutGates(passingSnapshot({ metrics: metrics({ bodyBudgetExhausted: true }) })).advisoryFailures,
    ["cost-budget"],
  );
  assert.deepEqual(
    evaluateRolloutGates(passingSnapshot({ metrics: metrics({ volumeAnomaly: "spike" }) })).advisoryFailures,
    ["cost-budget"],
  );
});

test("cost-budget passes exactly at the per-run + per-day boundaries", () => {
  const atBoundary = passingSnapshot({ discoveredPerRun: 200, bodyIngestedPerDay: 25, bodyIngestBudgetPerDay: 25 });
  assert.equal(evaluateRolloutGates(atBoundary).verdict, "go");
});

test("cost-budget ignores the per-run budget when it is null", () => {
  const noBudget = passingSnapshot({ metrics: metrics({ discoveryBudgetPerRun: null }), discoveredPerRun: 100000 });
  assert.equal(evaluateRolloutGates(noBudget).verdict, "go");
});

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

test("a single blocking failure alongside advisory failures still holds and lists both", () => {
  const verdict = evaluateRolloutGates(
    passingSnapshot({ oldItemFalsePositives: 3, queueDepth: MAX_QUEUE_DEPTH + 100 }),
  );
  assert.equal(verdict.verdict, "hold");
  assert.deepEqual(verdict.blockingFailures, ["no-old-item-false-positives"]);
  assert.deepEqual(verdict.advisoryFailures, ["queue-health"]);
  assert.deepEqual(verdict.failing.sort(), ["no-old-item-false-positives", "queue-health"]);
});

test("gate details never contain a URL scheme (sanitized counts/labels only)", () => {
  const verdict = evaluateRolloutGates(
    passingSnapshot({ oldItemFalsePositives: 1, duplicateWork: 2, queueDepth: 9999 }),
  );
  for (const g of verdict.gates) {
    assert.ok(!/https?:\/\//i.test(g.detail), `detail leaked a URL: ${g.detail}`);
  }
});

// ---------------------------------------------------------------------------
// Activation acceptance matrix — fail-closed
// ---------------------------------------------------------------------------

/** A fully-ready activation record. */
function readyActivation(overrides: Partial<ActivationReadiness> = {}): ActivationReadiness {
  return {
    baselineEvidence: { completed: true, observedCount: 1234 },
    shadowEvidence: { exitGateVerdict: "pass" },
    approval: { approvedBy: "operator-handle", approvedAt: new Date("2026-07-19T23:30:00Z") },
    activeDefinitionVersion: 2,
    budgets: { perRun: 200, perDay: 25 },
    rollbackOwner: "owner-handle",
    ...overrides,
  };
}

test("activation acceptance matrix is ready when every requirement is satisfied", () => {
  const verdict = evaluateActivationReadiness(readyActivation());
  assert.equal(verdict.ready, true);
  assert.deepEqual(verdict.missing, []);
  assert.deepEqual(
    verdict.requirements.map((r) => r.requirement).sort(),
    [...ACTIVATION_REQUIREMENTS].sort(),
  );
});

test("acceptance matrix FAILS CLOSED when all evidence is absent (nulls)", () => {
  const verdict = evaluateActivationReadiness({
    baselineEvidence: null,
    shadowEvidence: null,
    approval: null,
    activeDefinitionVersion: null,
    budgets: null,
    rollbackOwner: null,
  });
  assert.equal(verdict.ready, false);
  assert.deepEqual(verdict.missing.sort(), [...ACTIVATION_REQUIREMENTS].sort());
});

test("acceptance matrix fails on each missing requirement individually", () => {
  const cases: Array<[Partial<ActivationReadiness>, string]> = [
    [{ baselineEvidence: null }, "baseline-evidence"],
    [{ baselineEvidence: { completed: false, observedCount: 0 } }, "baseline-evidence"],
    [{ shadowEvidence: null }, "shadow-evidence"],
    [{ shadowEvidence: { exitGateVerdict: "fail" } }, "shadow-evidence"],
    [{ approval: null }, "explicit-approval"],
    [{ approval: { approvedBy: "  ", approvedAt: new Date() } }, "explicit-approval"],
    [{ activeDefinitionVersion: null }, "active-definition-version"],
    [{ activeDefinitionVersion: 0 }, "active-definition-version"],
    [{ budgets: null }, "budgets-configured"],
    [{ budgets: { perRun: 0, perDay: 25 } }, "budgets-configured"],
    [{ budgets: { perRun: 200, perDay: null } }, "budgets-configured"],
    [{ rollbackOwner: null }, "rollback-owner"],
    [{ rollbackOwner: "" }, "rollback-owner"],
  ];
  for (const [override, expectedMissing] of cases) {
    const verdict = evaluateActivationReadiness(readyActivation(override));
    assert.equal(verdict.ready, false, `expected NOT ready for ${expectedMissing}`);
    assert.ok(
      verdict.missing.includes(expectedMissing as (typeof ACTIVATION_REQUIREMENTS)[number]),
      `expected missing to include ${expectedMissing}, got ${verdict.missing.join(",")}`,
    );
  }
});

test("acceptance-matrix details never echo the operator handle or a URL", () => {
  const verdict = evaluateActivationReadiness(
    readyActivation({ approval: { approvedBy: "secret-operator@example.com", approvedAt: new Date() }, rollbackOwner: "https://intranet/owner" }),
  );
  for (const r of verdict.requirements) {
    assert.ok(!r.detail.includes("secret-operator"), `detail leaked approver handle: ${r.detail}`);
    assert.ok(!/https?:\/\//i.test(r.detail), `detail leaked a URL: ${r.detail}`);
  }
});
