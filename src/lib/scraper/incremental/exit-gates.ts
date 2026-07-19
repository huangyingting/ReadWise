/**
 * PURE Phase-1 exit-gate evaluator (issue #1090, Phase 1.10) — the heart of the
 * capstone.
 *
 * Given a canary's METADATA-ONLY snapshot (the #1089 {@link SourceMetricSummary}
 * plus the {@link ReconciliationResult} and controlled fault-recovery / duplicate
 * / volume counts), this module evaluates the quantitative Phase-1 exit gates and
 * returns a per-gate pass/fail plus an overall verdict. It contains NO database,
 * network, or clock access, mirroring the pure-logic house style
 * (`classify.ts` / `frontier.ts` / `lifecycle.ts` / `observability.ts`).
 *
 * The gates are HARD ZEROS — they are the go/no-go correctness bar for the whole
 * program and are NEVER relaxed to make a source pass (explicit non-goal). A
 * source that fails ANY gate must remain SHADOWED (enforced on the activation
 * path by `lifecycle-commit.ts`).
 *
 * Every detail string is a controlled count/label — never a URL, body, or secret
 * (AC4).
 */
import type { SourceMetricSummary } from "./observability";
import type { ReconciliationResult } from "./reconciliation";

/** The five quantitative Phase-1 exit gates. */
export type ExitGateName =
  | "no-old-item-false-positives"
  | "no-duplicate-jobs"
  | "no-unexplained-misses"
  | "recovery-successful"
  | "within-budget";

/** The complete, ordered gate set (used by the UI + tests). */
export const EXIT_GATES: readonly ExitGateName[] = [
  "no-old-item-false-positives",
  "no-duplicate-jobs",
  "no-unexplained-misses",
  "recovery-successful",
  "within-budget",
];

/**
 * Metadata-only inputs the exit gates read. Every field is a controlled count,
 * enum, or the pure metric summary — never a URL/body/secret.
 */
export type ExitGateSnapshot = {
  /** The #1089 computed metric summary (status, drift, budget, volume anomaly). */
  metrics: SourceMetricSummary;
  /** Reconciliation of ledger observations vs a controlled provider sample. */
  reconciliation: ReconciliationResult;
  /**
   * Count of KNOWN/baseline identities that were reclassified as new (eligible /
   * queued). MUST be zero — the governing invariant forbids reviving a known
   * public identity. Computed from candidate state (a baseline observation that
   * became QUEUED/INGESTING/INGESTED).
   */
  oldItemFalsePositives: number;
  /**
   * Count of duplicate ingest jobs — more than one queued/ingest job for a single
   * identity. MUST be zero (identity uniqueness makes new dupes impossible; this
   * proves it).
   */
  duplicateJobs: number;
  /** Number of controlled fault simulations that were RUN against the canary. */
  faultsInjected: number;
  /** Of the injected faults, how many did NOT recover to a safe state. */
  unrecoveredFaults: number;
  /** New identities discovered in the most recent completed run (volume/cost). */
  discoveredPerRun: number;
};

/** A single gate's evaluation. */
export type GateResult = {
  gate: ExitGateName;
  passed: boolean;
  /** Sanitized, count-only explanation (never a URL/body/secret). */
  detail: string;
};

/** The overall exit-gate verdict for a canary. */
export type ExitGateVerdict = {
  verdict: "pass" | "fail";
  gates: GateResult[];
  /** The gates that failed (empty when `verdict === "pass"`). */
  failing: ExitGateName[];
};

function gate(name: ExitGateName, passed: boolean, detail: string): GateResult {
  return { gate: name, passed, detail };
}

/**
 * Evaluates all Phase-1 exit gates for a canary snapshot. Deterministic: the same
 * snapshot always yields the same verdict. The overall verdict is `pass` only
 * when EVERY gate passes.
 */
export function evaluateExitGates(snapshot: ExitGateSnapshot): ExitGateVerdict {
  const { metrics, reconciliation } = snapshot;

  const results: GateResult[] = [
    gate(
      "no-old-item-false-positives",
      snapshot.oldItemFalsePositives === 0,
      `oldItemFalsePositives=${snapshot.oldItemFalsePositives} (must be 0)`,
    ),
    gate(
      "no-duplicate-jobs",
      snapshot.duplicateJobs === 0,
      `duplicateJobs=${snapshot.duplicateJobs} (must be 0)`,
    ),
    gate(
      "no-unexplained-misses",
      reconciliation.unexplainedMisses === 0,
      `unexplainedMisses=${reconciliation.unexplainedMisses} of sampleSize=${reconciliation.sampleSize} (must be 0)`,
    ),
    gate(
      "recovery-successful",
      snapshot.faultsInjected > 0 && snapshot.unrecoveredFaults === 0,
      `faultsInjected=${snapshot.faultsInjected}, unrecoveredFaults=${snapshot.unrecoveredFaults} (need faultsInjected>0 and unrecoveredFaults=0)`,
    ),
    gate(
      "within-budget",
      withinBudget(snapshot),
      budgetDetail(snapshot),
    ),
  ];

  const failing = results.filter((r) => !r.passed).map((r) => r.gate);
  return {
    verdict: failing.length === 0 ? "pass" : "fail",
    gates: results,
    failing,
  };
}

/**
 * Volume/cost budget bound: the last run's discovery volume is within the source's
 * per-run discovery budget (when set) AND the discovery volume is not a `spike`
 * anomaly.
 */
function withinBudget(snapshot: ExitGateSnapshot): boolean {
  const budget = snapshot.metrics.discoveryBudgetPerRun;
  const underBudget = budget == null || snapshot.discoveredPerRun <= budget;
  return underBudget && snapshot.metrics.volumeAnomaly !== "spike";
}

function budgetDetail(snapshot: ExitGateSnapshot): string {
  const budget = snapshot.metrics.discoveryBudgetPerRun;
  const budgetLabel = budget == null ? "none" : String(budget);
  return `discoveredPerRun=${snapshot.discoveredPerRun}, budget=${budgetLabel}, volumeAnomaly=${snapshot.metrics.volumeAnomaly}`;
}
