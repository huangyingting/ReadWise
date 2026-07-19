/**
 * Pure unit tests for the Phase-1 exit-gate evaluator (issue #1090, Phase 1.10).
 *
 * `exit-gates.ts` is PURE — no DB/network/clock. These tests prove each of the
 * five gates passes on a clean snapshot and fails on its own violation, and that
 * the overall verdict is `pass` only when EVERY gate passes.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXIT_GATES,
  evaluateExitGates,
  type ExitGateName,
  type ExitGateSnapshot,
} from "@/lib/scraper/incremental/exit-gates";
import type { SourceMetricSummary } from "@/lib/scraper/incremental/observability";
import { emptyReconciliation, reconcile } from "@/lib/scraper/incremental/reconciliation";

/** A minimal passing metric summary (only the fields the gates read matter). */
function metrics(overrides: Partial<SourceMetricSummary> = {}): SourceMetricSummary {
  return {
    discoveryBudgetPerRun: 200,
    volumeAnomaly: "none",
    ...overrides,
  } as unknown as SourceMetricSummary;
}

/** A fully-passing snapshot: every gate green. */
function passingSnapshot(overrides: Partial<ExitGateSnapshot> = {}): ExitGateSnapshot {
  return {
    metrics: metrics(),
    reconciliation: emptyReconciliation(),
    oldItemFalsePositives: 0,
    duplicateJobs: 0,
    faultsInjected: 7,
    unrecoveredFaults: 0,
    discoveredPerRun: 10,
    ...overrides,
  };
}

test("all gates pass on a clean snapshot", () => {
  const verdict = evaluateExitGates(passingSnapshot());
  assert.equal(verdict.verdict, "pass");
  assert.deepEqual(verdict.failing, []);
  assert.deepEqual(
    verdict.gates.map((g) => g.gate).sort(),
    [...EXIT_GATES].sort(),
  );
  assert.ok(verdict.gates.every((g) => g.passed));
});

test("no-old-item-false-positives fails when a baseline identity is revived", () => {
  const verdict = evaluateExitGates(passingSnapshot({ oldItemFalsePositives: 1 }));
  assert.equal(verdict.verdict, "fail");
  assert.deepEqual(verdict.failing, ["no-old-item-false-positives"]);
});

test("no-duplicate-jobs fails when an identity has two jobs", () => {
  const verdict = evaluateExitGates(passingSnapshot({ duplicateJobs: 2 }));
  assert.equal(verdict.verdict, "fail");
  assert.deepEqual(verdict.failing, ["no-duplicate-jobs"]);
});

test("no-unexplained-misses fails when reconciliation finds an unexplained miss", () => {
  const reconciliation = reconcile(
    [{ identityKey: "v1:aaa", expectedObservable: true }],
    [],
  );
  const verdict = evaluateExitGates(passingSnapshot({ reconciliation }));
  assert.equal(verdict.verdict, "fail");
  assert.deepEqual(verdict.failing, ["no-unexplained-misses"]);
});

test("recovery-successful fails when no faults were injected (fail-closed)", () => {
  const verdict = evaluateExitGates(passingSnapshot({ faultsInjected: 0, unrecoveredFaults: 0 }));
  assert.equal(verdict.verdict, "fail");
  assert.deepEqual(verdict.failing, ["recovery-successful"]);
});

test("recovery-successful fails when a fault did not recover", () => {
  const verdict = evaluateExitGates(passingSnapshot({ faultsInjected: 7, unrecoveredFaults: 1 }));
  assert.equal(verdict.verdict, "fail");
  assert.deepEqual(verdict.failing, ["recovery-successful"]);
});

test("within-budget fails when discovery volume exceeds the per-run budget", () => {
  const verdict = evaluateExitGates(
    passingSnapshot({ discoveredPerRun: 500, metrics: metrics({ discoveryBudgetPerRun: 200 }) }),
  );
  assert.equal(verdict.verdict, "fail");
  assert.deepEqual(verdict.failing, ["within-budget"]);
});

test("within-budget fails on a volume spike anomaly even under the count budget", () => {
  const verdict = evaluateExitGates(
    passingSnapshot({ discoveredPerRun: 5, metrics: metrics({ volumeAnomaly: "spike" }) }),
  );
  assert.equal(verdict.verdict, "fail");
  assert.deepEqual(verdict.failing, ["within-budget"]);
});

test("within-budget passes when no budget is set and volume is not a spike", () => {
  const verdict = evaluateExitGates(
    passingSnapshot({ discoveredPerRun: 9999, metrics: metrics({ discoveryBudgetPerRun: null }) }),
  );
  assert.equal(verdict.verdict, "pass");
});

test("multiple gate failures are all reported", () => {
  const verdict = evaluateExitGates(
    passingSnapshot({ oldItemFalsePositives: 1, duplicateJobs: 3 }),
  );
  assert.equal(verdict.verdict, "fail");
  const failing = verdict.failing.slice().sort();
  assert.deepEqual(failing, (["no-duplicate-jobs", "no-old-item-false-positives"] as ExitGateName[]).sort());
});
