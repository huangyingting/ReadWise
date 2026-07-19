/**
 * Thin DB-backed assembler for a canary's Phase-1 exit-gate verdict (issue #1090,
 * Phase 1.10).
 *
 * The DECISION is pure (`exit-gates.ts`); this layer only reads a metadata-only
 * snapshot for a live {@link DiscoverySource} and hands it to
 * {@link evaluateExitGates}. It reuses the #1089 metric summary
 * (`observability-query.ts`) and derives the correctness counts directly from the
 * candidate ledger:
 *
 *   - `oldItemFalsePositives` — baseline observations (`observedInBaseline = true`)
 *     that were promoted to QUEUED/INGESTING/INGESTED (a known/old identity
 *     revived as new — the governing invariant forbids this).
 *   - `duplicateJobs` — identities with more than one queued/ingest candidate.
 *
 * Reconciliation results and fault-recovery evidence are OPERATIONAL facts the
 * operator's soak produces; they are passed in. When absent the guard is
 * FAIL-CLOSED (no proven recovery → the `recovery-successful` gate fails), so a
 * canary can never reach ACTIVE through the admin path until its soak evidence is
 * supplied. This upholds AC2 without a schema change.
 *
 * Every value read here is a controlled count/status — never a URL/body/secret.
 */
import { CrawlCandidateStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { evaluateExitGates, type ExitGateSnapshot, type ExitGateVerdict } from "./exit-gates";
import type { ExitGateGuard } from "./lifecycle-commit";
import { getDiscoverySourceMetrics } from "./observability-query";
import { emptyReconciliation, type ReconciliationResult } from "./reconciliation";

const S = CrawlCandidateStatus;
const JOB_STATUSES = [S.QUEUED, S.INGESTING, S.INGESTED] as const;

/** Operator-supplied soak evidence (metadata only) combined with DB-derived signals. */
export type CanaryExitGateEvidence = {
  now?: Date;
  /** Reconciliation of ledger observations vs a controlled provider sample. */
  reconciliation?: ReconciliationResult;
  /** Fault-simulation recovery evidence from the soak (counts only). */
  faultEvidence?: { faultsInjected: number; unrecoveredFaults: number };
  /** New identities discovered in the most recent completed run (volume/cost). */
  discoveredPerRun?: number;
};

/** A verdict that fails EVERY gate — used when the source cannot be read. */
function unreadableVerdict(): ExitGateVerdict {
  return {
    verdict: "fail",
    gates: [],
    failing: ["no-old-item-false-positives"],
  };
}

/** Counts baseline observations that were revived as new jobs (must be 0). */
async function oldItemFalsePositivesFor(sourceId: string): Promise<number> {
  return prisma.crawlCandidate.count({
    where: {
      discoverySourceId: sourceId,
      observedInBaseline: true,
      status: { in: [...JOB_STATUSES] },
    },
  });
}

/** Counts identities with more than one queued/ingest candidate (must be 0). */
async function duplicateJobsFor(sourceId: string): Promise<number> {
  const groups = await prisma.crawlCandidate.groupBy({
    by: ["providerKey", "identityVersion", "provisionalKey"],
    where: { discoverySourceId: sourceId, status: { in: [...JOB_STATUSES] } },
    _count: { _all: true },
  });
  return groups.filter((g) => g._count._all > 1).length;
}

/**
 * Assembles the metadata-only exit-gate snapshot for a source and evaluates the
 * pure gates. Fail-closed when the source is missing or no fault-recovery evidence
 * was supplied.
 */
export async function evaluateCanaryExitGatesForSource(
  sourceId: string,
  evidence: CanaryExitGateEvidence = {},
): Promise<ExitGateVerdict> {
  const now = evidence.now ?? new Date();
  const dto = await getDiscoverySourceMetrics(sourceId, now);
  if (!dto) return unreadableVerdict();

  const [oldItemFalsePositives, duplicateJobs] = await Promise.all([
    oldItemFalsePositivesFor(sourceId),
    duplicateJobsFor(sourceId),
  ]);

  const snapshot: ExitGateSnapshot = {
    metrics: dto.metrics,
    reconciliation: evidence.reconciliation ?? emptyReconciliation(),
    oldItemFalsePositives,
    duplicateJobs,
    faultsInjected: evidence.faultEvidence?.faultsInjected ?? 0,
    unrecoveredFaults: evidence.faultEvidence?.unrecoveredFaults ?? 0,
    discoveredPerRun: evidence.discoveredPerRun ?? 0,
  };

  return evaluateExitGates(snapshot);
}

/**
 * Builds an {@link ExitGateGuard} bound to a source (+ optional soak evidence) for
 * the activation path. Returns the compact `{ verdict, failing }` shape the guard
 * contract needs.
 */
export function canaryExitGateGuard(
  sourceId: string,
  evidence: CanaryExitGateEvidence = {},
): ExitGateGuard {
  return async () => {
    const verdict = await evaluateCanaryExitGatesForSource(sourceId, evidence);
    return { verdict: verdict.verdict, failing: verdict.failing };
  };
}
