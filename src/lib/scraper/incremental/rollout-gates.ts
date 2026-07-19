/**
 * PURE measured-rollout gate evaluator (issue #1098, Phase 2.8).
 *
 * Phase 1.10 proved the three canaries in shadow with the {@link evaluateExitGates}
 * capstone; Phase 2.5–2.7 built the atomic Article save, the activation-generation
 * guard, and the active→shadow rollback. Phase 2.8 rolls REAL body ingestion out
 * to public providers in measured batches — but only while a metadata-only set of
 * ROLLOUT GATES stays green. This module is that gate evaluator plus the
 * activation-readiness "acceptance matrix" run before every batch.
 *
 * Like `exit-gates.ts`, it is PURE: it takes a metadata-only snapshot (the #1089
 * {@link SourceMetricSummary}, the {@link ReconciliationResult}, and controlled
 * count inputs) plus an explicit `now`, and returns a per-gate pass/fail with a
 * go/no-go verdict. It contains NO database, network, or clock access, mirroring
 * the pure-logic house style (`classify.ts` / `frontier.ts` / `lifecycle.ts` /
 * `observability.ts` / `exit-gates.ts`).
 *
 * Gate classes:
 *   - BLOCKING (correctness) gates are HARD ZEROS — they encode the governing
 *     invariant and identity/gap correctness and are NEVER relaxed to make a
 *     source pass (explicit non-goal): no revived old items, no duplicate work,
 *     no unexplained gaps.
 *   - ADVISORY (threshold) gates are conservative, tunable bounds on freshness,
 *     queue health, retry/quarantine rate, provider HTTP health, and cost.
 *
 * The overall verdict is `"go"` ONLY when EVERY gate (blocking AND advisory)
 * passes; a red gate of any class holds the rollout. The blocking failures are
 * surfaced separately so an operator can see which failures are absolute
 * correctness stops versus tunable-threshold warnings.
 *
 * Every `detail` string is a controlled count/label/enum — NEVER a URL, body,
 * secret, or article text (privacy invariant AC4). Operator handles (approver,
 * rollback owner) are reported as presence flags only, never echoed.
 */
import { DiscoverySourceHealth } from "@prisma/client";

import type { SourceMetricSummary } from "./observability";
import type { ReconciliationResult } from "./reconciliation";

// ---------------------------------------------------------------------------
// Gate thresholds — explicit, named, conservative constants (all tunable)
// ---------------------------------------------------------------------------

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;

/** Max p90 publication→discovery lag (seconds) for the freshness gate. */
export const MAX_DISCOVERY_LAG_SECONDS = 12 * HOUR_SECONDS;
/** Max age (seconds) of the most recent COMPLETED discovery run (freshness). */
export const MAX_DISCOVERY_RUN_AGE_SECONDS = 2 * DAY_SECONDS;
/** Max Job-worker queue DEPTH (pending ingest + downstream jobs) for the tier. */
export const MAX_QUEUE_DEPTH = 500;
/** Max AGE (seconds) of the oldest pending Job-worker item. */
export const MAX_QUEUE_AGE_SECONDS = 1 * HOUR_SECONDS;
/** Max retry rate (retried / attempts) tolerated in the observation window. */
export const MAX_RETRY_RATE = 0.1;
/** Max quarantine rate (quarantined / attempts) tolerated in the window. */
export const MAX_QUARANTINE_RATE = 0.02;

// ---------------------------------------------------------------------------
// Gate taxonomy
// ---------------------------------------------------------------------------

/** The metadata-only rollout gates evaluated before/while a batch is live. */
export type RolloutGateName =
  | "discovery-latency"
  | "no-old-item-false-positives"
  | "no-duplicate-work"
  | "queue-health"
  | "retry-quarantine-rate"
  | "no-unexplained-gaps"
  | "provider-http-health"
  | "cost-budget";

/**
 * A gate's class. BLOCKING gates encode correctness invariants (hard zeros) and
 * are never relaxed; ADVISORY gates are conservative, tunable thresholds.
 */
export type RolloutGateSeverity = "blocking" | "advisory";

/** The complete, ordered gate set (used by the admin UI + tests). */
export const ROLLOUT_GATES: readonly RolloutGateName[] = [
  "discovery-latency",
  "no-old-item-false-positives",
  "no-duplicate-work",
  "queue-health",
  "retry-quarantine-rate",
  "no-unexplained-gaps",
  "provider-http-health",
  "cost-budget",
];

/** Class of each gate. The three correctness gates are BLOCKING hard zeros. */
export const ROLLOUT_GATE_SEVERITY: Readonly<Record<RolloutGateName, RolloutGateSeverity>> = {
  "discovery-latency": "advisory",
  "no-old-item-false-positives": "blocking",
  "no-duplicate-work": "blocking",
  "queue-health": "advisory",
  "retry-quarantine-rate": "advisory",
  "no-unexplained-gaps": "blocking",
  "provider-http-health": "advisory",
  "cost-budget": "advisory",
};

// ---------------------------------------------------------------------------
// Inputs — a metadata-only snapshot (never a URL / body / secret)
// ---------------------------------------------------------------------------

/**
 * Metadata-only inputs the rollout gates read. Reuses the pure #1089 metric
 * summary and #1090 reconciliation result; the remaining fields are controlled
 * counts the thin assembler passes in (mirroring `exit-gates.ts`). Every field
 * is a count, enum, or the pure metric summary — never a URL/body/secret.
 */
export type RolloutGateSnapshot = {
  /** The #1089 computed metric summary (status, health, delays, budget, host pause). */
  metrics: SourceMetricSummary;
  /** Reconciliation of ledger observations vs a controlled provider sample. */
  reconciliation: ReconciliationResult;
  /**
   * KNOWN/baseline identities reclassified as new (queued/ingesting/ingested).
   * MUST be 0 — the governing invariant forbids reviving a known public identity.
   */
  oldItemFalsePositives: number;
  /**
   * Duplicate downstream work — more than one ingest job OR more than one Article
   * for a single identity. MUST be 0 (identity uniqueness makes new dupes
   * impossible; this proves it).
   */
  duplicateWork: number;
  /** Job-worker queue DEPTH: pending candidate-ingest + downstream jobs. */
  queueDepth: number;
  /** Age (seconds) of the OLDEST pending Job-worker item (0 when the queue is empty). */
  queueOldestAgeSeconds: number;
  /** Ingest/enrichment attempts in the observation window (rate denominator). */
  ingestAttempts: number;
  /** Of those attempts, how many were retried (transient-failure retries). */
  retriedJobs: number;
  /** Of those attempts, how many items were quarantined. */
  quarantinedItems: number;
  /** New identities discovered in the most recent completed run (per-run cost). */
  discoveredPerRun: number;
  /** Bodies actually ingested in the last 24h (per-day cost vs the tier budget). */
  bodyIngestedPerDay: number;
  /** Per-day body-ingestion budget for this source's rollout tier (rollout-batches). */
  bodyIngestBudgetPerDay: number;
};

/** A single gate's evaluation. */
export type RolloutGateResult = {
  gate: RolloutGateName;
  severity: RolloutGateSeverity;
  passed: boolean;
  /** Sanitized, count/label/enum-only explanation (never a URL/body/secret). */
  detail: string;
};

/** The overall go/no-go rollout verdict for a source. */
export type RolloutGateVerdict = {
  /** `go` only when EVERY gate passes; a red gate of any class holds the rollout. */
  verdict: "go" | "hold";
  gates: RolloutGateResult[];
  /** Every failing gate (empty when `verdict === "go"`). */
  failing: RolloutGateName[];
  /** Failing BLOCKING (correctness hard-zero) gates — absolute stops. */
  blockingFailures: RolloutGateName[];
  /** Failing ADVISORY (tunable-threshold) gates — tunable warnings. */
  advisoryFailures: RolloutGateName[];
};

function gate(name: RolloutGateName, passed: boolean, detail: string): RolloutGateResult {
  return { gate: name, severity: ROLLOUT_GATE_SEVERITY[name], passed, detail };
}

// ---------------------------------------------------------------------------
// Gate evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluates all Phase-2.8 rollout gates for a source snapshot. Deterministic:
 * the same snapshot always yields the same verdict. The overall verdict is `go`
 * only when EVERY gate passes.
 */
export function evaluateRolloutGates(snapshot: RolloutGateSnapshot): RolloutGateVerdict {
  const { metrics, reconciliation } = snapshot;

  const results: RolloutGateResult[] = [
    gate("discovery-latency", withinDiscoveryLatency(metrics), discoveryLatencyDetail(metrics)),
    gate(
      "no-old-item-false-positives",
      snapshot.oldItemFalsePositives === 0,
      `oldItemFalsePositives=${snapshot.oldItemFalsePositives} (must be 0)`,
    ),
    gate(
      "no-duplicate-work",
      snapshot.duplicateWork === 0,
      `duplicateWork=${snapshot.duplicateWork} (must be 0)`,
    ),
    gate("queue-health", withinQueueHealth(snapshot), queueHealthDetail(snapshot)),
    gate(
      "retry-quarantine-rate",
      withinRetryQuarantine(snapshot),
      retryQuarantineDetail(snapshot),
    ),
    gate(
      "no-unexplained-gaps",
      reconciliation.unexplainedMisses === 0,
      `unexplainedMisses=${reconciliation.unexplainedMisses} of sampleSize=${reconciliation.sampleSize} (must be 0)`,
    ),
    gate("provider-http-health", providerHttpHealthy(metrics), providerHttpHealthDetail(metrics)),
    gate("cost-budget", withinCostBudget(snapshot), costBudgetDetail(snapshot)),
  ];

  const failing = results.filter((r) => !r.passed).map((r) => r.gate);
  const blockingFailures = results
    .filter((r) => !r.passed && r.severity === "blocking")
    .map((r) => r.gate);
  const advisoryFailures = results
    .filter((r) => !r.passed && r.severity === "advisory")
    .map((r) => r.gate);

  return {
    verdict: failing.length === 0 ? "go" : "hold",
    gates: results,
    failing,
    blockingFailures,
    advisoryFailures,
  };
}

// ---------------------------------------------------------------------------
// Advisory gate predicates
// ---------------------------------------------------------------------------

/**
 * Freshness: the p90 publication→discovery lag is within threshold (when there
 * is a sample) AND the most recent completed discovery run is recent. A source
 * that has never run (null run age) fails closed — freshness is unproven.
 */
function withinDiscoveryLatency(metrics: SourceMetricSummary): boolean {
  const delay = metrics.publicationToDiscoveryDelay;
  const lagOk = delay === null || delay.p90Seconds <= MAX_DISCOVERY_LAG_SECONDS;
  const runAgeOk =
    metrics.lastRunAgeSeconds !== null &&
    metrics.lastRunAgeSeconds <= MAX_DISCOVERY_RUN_AGE_SECONDS;
  return lagOk && runAgeOk;
}

function discoveryLatencyDetail(metrics: SourceMetricSummary): string {
  const p90 = metrics.publicationToDiscoveryDelay?.p90Seconds ?? null;
  return `p90LagSeconds=${p90 ?? "none"} (<= ${MAX_DISCOVERY_LAG_SECONDS}), lastRunAgeSeconds=${metrics.lastRunAgeSeconds ?? "never"} (<= ${MAX_DISCOVERY_RUN_AGE_SECONDS})`;
}

/** Queue health: worker backlog depth and oldest-item age both within threshold. */
function withinQueueHealth(snapshot: RolloutGateSnapshot): boolean {
  return (
    snapshot.queueDepth <= MAX_QUEUE_DEPTH &&
    snapshot.queueOldestAgeSeconds <= MAX_QUEUE_AGE_SECONDS
  );
}

function queueHealthDetail(snapshot: RolloutGateSnapshot): string {
  return `queueDepth=${snapshot.queueDepth} (<= ${MAX_QUEUE_DEPTH}), queueOldestAgeSeconds=${snapshot.queueOldestAgeSeconds} (<= ${MAX_QUEUE_AGE_SECONDS})`;
}

/** Retry + quarantine rates both within threshold (0 attempts ⇒ 0 rate ⇒ pass). */
function withinRetryQuarantine(snapshot: RolloutGateSnapshot): boolean {
  return retryRate(snapshot) <= MAX_RETRY_RATE && quarantineRate(snapshot) <= MAX_QUARANTINE_RATE;
}

function retryRate(snapshot: RolloutGateSnapshot): number {
  return snapshot.ingestAttempts > 0 ? snapshot.retriedJobs / snapshot.ingestAttempts : 0;
}

function quarantineRate(snapshot: RolloutGateSnapshot): number {
  return snapshot.ingestAttempts > 0 ? snapshot.quarantinedItems / snapshot.ingestAttempts : 0;
}

function retryQuarantineDetail(snapshot: RolloutGateSnapshot): string {
  const retry = retryRate(snapshot).toFixed(3);
  const quarantine = quarantineRate(snapshot).toFixed(3);
  return `retryRate=${retry} (<= ${MAX_RETRY_RATE}), quarantineRate=${quarantine} (<= ${MAX_QUARANTINE_RATE}), attempts=${snapshot.ingestAttempts}`;
}

/** Provider HTTP health: source not DEGRADED/FAILING/BLOCKED and no active host pause. */
const UNHEALTHY_HEALTH: ReadonlySet<DiscoverySourceHealth> = new Set([
  DiscoverySourceHealth.DEGRADED,
  DiscoverySourceHealth.FAILING,
  DiscoverySourceHealth.BLOCKED,
]);

function providerHttpHealthy(metrics: SourceMetricSummary): boolean {
  return !UNHEALTHY_HEALTH.has(metrics.health) && !metrics.hostPauseActive;
}

function providerHttpHealthDetail(metrics: SourceMetricSummary): string {
  return `health=${metrics.health}, hostPauseActive=${metrics.hostPauseActive}, hostConsecutiveErrors=${metrics.hostConsecutiveErrors}`;
}

/**
 * Cost/budget: within the per-run discovery budget AND the per-day body-ingestion
 * budget for the tier, no governor budget exhaustion, and no `spike` volume
 * anomaly.
 */
function withinCostBudget(snapshot: RolloutGateSnapshot): boolean {
  const { metrics } = snapshot;
  const perRunBudget = metrics.discoveryBudgetPerRun;
  const underPerRun = perRunBudget == null || snapshot.discoveredPerRun <= perRunBudget;
  const underPerDay = snapshot.bodyIngestedPerDay <= snapshot.bodyIngestBudgetPerDay;
  const notExhausted =
    !metrics.discoveryBudgetExhausted && !metrics.bodyBudgetExhausted && !metrics.aiBudgetExhausted;
  return underPerRun && underPerDay && notExhausted && metrics.volumeAnomaly !== "spike";
}

function costBudgetDetail(snapshot: RolloutGateSnapshot): string {
  const { metrics } = snapshot;
  const perRunBudget = metrics.discoveryBudgetPerRun == null ? "none" : String(metrics.discoveryBudgetPerRun);
  return (
    `discoveredPerRun=${snapshot.discoveredPerRun} (<= ${perRunBudget}), ` +
    `bodyIngestedPerDay=${snapshot.bodyIngestedPerDay} (<= ${snapshot.bodyIngestBudgetPerDay}), ` +
    `volumeAnomaly=${metrics.volumeAnomaly}, ` +
    `budgetExhausted=[discovery=${metrics.discoveryBudgetExhausted},body=${metrics.bodyBudgetExhausted},ai=${metrics.aiBudgetExhausted}]`
  );
}

// ---------------------------------------------------------------------------
// Activation-readiness "acceptance matrix" (AC1) — fail-closed
// ---------------------------------------------------------------------------

/**
 * The per-provider activation requirements checked BEFORE every batch: each
 * activation must have attached baseline + shadow evidence, an explicit approval,
 * an active definition version, configured budgets, and a named rollback owner.
 */
export type ActivationRequirement =
  | "baseline-evidence"
  | "shadow-evidence"
  | "explicit-approval"
  | "active-definition-version"
  | "budgets-configured"
  | "rollback-owner";

/** The complete, ordered acceptance-matrix requirement set. */
export const ACTIVATION_REQUIREMENTS: readonly ActivationRequirement[] = [
  "baseline-evidence",
  "shadow-evidence",
  "explicit-approval",
  "active-definition-version",
  "budgets-configured",
  "rollback-owner",
];

/**
 * Metadata-only activation-readiness record for one source. Absent (`null`)
 * evidence FAILS CLOSED — a requirement with no attached evidence is not ready
 * (mirrors the fail-closed recovery gate in `canary-exit-gate-eval.ts`). Operator
 * identities (approver, rollback owner) are opaque handles reported only as
 * presence flags, never echoed into details.
 */
export type ActivationReadiness = {
  /** Baseline soak evidence (completion flag + observed count) or null when absent. */
  baselineEvidence: { completed: boolean; observedCount: number } | null;
  /** Shadow soak exit-gate verdict (from `exit-gates.ts`) or null when absent. */
  shadowEvidence: { exitGateVerdict: "pass" | "fail" } | null;
  /** Explicit operator approval (opaque handle + timestamp) or null when absent. */
  approval: { approvedBy: string; approvedAt: Date } | null;
  /** Active definition version bound to the source, or null when unset. */
  activeDefinitionVersion: number | null;
  /** Per-run + per-day budgets configured for the tier, or null when unset. */
  budgets: { perRun: number | null; perDay: number | null } | null;
  /** Named rollback owner (opaque handle) or null when absent. */
  rollbackOwner: string | null;
};

/** A single requirement's readiness. */
export type ActivationRequirementResult = {
  requirement: ActivationRequirement;
  ready: boolean;
  /** Sanitized presence/count/enum detail — never an operator handle or URL. */
  detail: string;
};

/** The overall activation-readiness verdict for a source. */
export type ActivationReadinessVerdict = {
  /** `true` only when EVERY requirement is satisfied (fail-closed otherwise). */
  ready: boolean;
  requirements: ActivationRequirementResult[];
  /** Requirements that are not yet satisfied (empty when `ready`). */
  missing: ActivationRequirement[];
};

function requirement(
  name: ActivationRequirement,
  ready: boolean,
  detail: string,
): ActivationRequirementResult {
  return { requirement: name, ready, detail };
}

function isNonEmpty(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Evaluates the activation-readiness acceptance matrix for a source. Pure and
 * FAIL-CLOSED: any absent evidence, a failing shadow verdict, an unset definition
 * version, unset budgets, or a missing rollback owner leaves the source NOT ready.
 * Overall `ready` is true only when EVERY requirement passes.
 */
export function evaluateActivationReadiness(
  input: ActivationReadiness,
): ActivationReadinessVerdict {
  const baselineReady =
    input.baselineEvidence !== null &&
    input.baselineEvidence.completed &&
    input.baselineEvidence.observedCount > 0;
  const shadowReady =
    input.shadowEvidence !== null && input.shadowEvidence.exitGateVerdict === "pass";
  const approvalReady = input.approval !== null && isNonEmpty(input.approval.approvedBy);
  const definitionReady =
    input.activeDefinitionVersion !== null && input.activeDefinitionVersion > 0;
  const budgetsReady =
    input.budgets !== null &&
    input.budgets.perRun !== null &&
    input.budgets.perRun > 0 &&
    input.budgets.perDay !== null &&
    input.budgets.perDay > 0;
  const rollbackOwnerReady = isNonEmpty(input.rollbackOwner);

  const results: ActivationRequirementResult[] = [
    requirement(
      "baseline-evidence",
      baselineReady,
      `present=${input.baselineEvidence !== null}, observedCount=${input.baselineEvidence?.observedCount ?? 0}`,
    ),
    requirement(
      "shadow-evidence",
      shadowReady,
      `present=${input.shadowEvidence !== null}, exitGateVerdict=${input.shadowEvidence?.exitGateVerdict ?? "none"}`,
    ),
    requirement("explicit-approval", approvalReady, `present=${approvalReady}`),
    requirement(
      "active-definition-version",
      definitionReady,
      `definitionVersion=${input.activeDefinitionVersion ?? "none"}`,
    ),
    requirement(
      "budgets-configured",
      budgetsReady,
      `perRun=${input.budgets?.perRun ?? "none"}, perDay=${input.budgets?.perDay ?? "none"}`,
    ),
    requirement("rollback-owner", rollbackOwnerReady, `present=${rollbackOwnerReady}`),
  ];

  const missing = results.filter((r) => !r.ready).map((r) => r.requirement);
  return { ready: missing.length === 0, requirements: results, missing };
}
