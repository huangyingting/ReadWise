/**
 * Thin source-trust QUERY layer (issue #1100, Phase 3.1).
 *
 * Assembles the sanitized trust DTO the capability-gated admin API renders for a
 * promote/demote decision: the source identity, its CURRENT trust policy
 * (metadata-only booleans — never a credential), the evidence summary (sample
 * size, approval rate, old-item false-positive rate, drift evidence), and the
 * REPORTED promotion eligibility. It reuses the #1089 metric computation for the
 * drift signals and adds the governing-invariant tripwire count (pre-baseline
 * identities that became work). It NEVER mutates state, promotes, or reads a
 * URL/body/secret.
 */
import { CrawlCandidateStatus, DiscoverySourceLifecycleMode } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { getDiscoverySourceMetrics } from "./observability-query";
import {
  computeSourceTrustEvidence,
  decideSourceTrustEligibility,
  type SourceTrustDriftSignals,
  type SourceTrustEligibility,
  type SourceTrustEvidence,
} from "./source-trust-policy";

/** Candidate statuses that count as "accepted into work" (approved/ingesting/ingested). */
export const ACCEPTED_WORK_STATUSES: readonly CrawlCandidateStatus[] = [
  CrawlCandidateStatus.QUEUED,
  CrawlCandidateStatus.INGESTING,
  CrawlCandidateStatus.INGESTED,
];

/** The metadata-only trust-policy booleans (never a credential/secret). */
export type SourceTrustPolicySnapshot = {
  autoPublishTrusted: boolean;
  canRepublishPublicly: boolean;
  canFetchAuthenticated: boolean;
};

/** The sanitized trust DTO for one source. */
export type SourceTrustDto = {
  id: string;
  providerKey: string;
  sourceKey: string;
  definitionVersion: number;
  lifecycleMode: DiscoverySourceLifecycleMode;
  policy: SourceTrustPolicySnapshot;
  evidence: SourceTrustEvidence;
  eligibility: SourceTrustEligibility;
};

/**
 * Counts pre-baseline (`observedInBaseline`) identities that were nonetheless
 * accepted into work — a governing-invariant violation. Expected to be ZERO; any
 * positive count is a hard promotion blocker AND an auto-demotion trigger.
 */
export async function countOldItemFalsePositives(sourceId: string): Promise<number> {
  return prisma.crawlCandidate.count({
    where: {
      discoverySourceId: sourceId,
      observedInBaseline: true,
      status: { in: [...ACCEPTED_WORK_STATUSES] },
    },
  });
}

/**
 * Returns the full sanitized trust snapshot for ONE source (identity + current
 * policy + evidence + reported eligibility), or `null` when the source does not
 * exist. Read-only.
 */
export async function getSourceTrustSnapshot(
  sourceId: string,
  now: Date = new Date(),
): Promise<SourceTrustDto | null> {
  const [metricsDto, source, oldItemFalsePositives] = await Promise.all([
    getDiscoverySourceMetrics(sourceId, now),
    prisma.discoverySource.findUnique({
      where: { id: sourceId },
      select: {
        autoPublishTrusted: true,
        canRepublishPublicly: true,
        canFetchAuthenticated: true,
        lifecycleMode: true,
      },
    }),
    countOldItemFalsePositives(sourceId),
  ]);
  if (!metricsDto || !source) return null;

  const metrics = metricsDto.metrics;
  const drift: SourceTrustDriftSignals = {
    zeroDiscoveryStreak: metrics.zeroDiscoveryStreak,
    consecutiveFailures: metrics.consecutiveFailures,
    volumeAnomaly: metrics.volumeAnomaly,
    conflictRate: metrics.conflictRate,
    oldItemFalsePositives,
  };
  const evidence = computeSourceTrustEvidence({
    candidateCounts: metrics.candidateCounts,
    drift,
  });
  const eligibility = decideSourceTrustEligibility(evidence);

  return {
    id: metricsDto.id,
    providerKey: metricsDto.providerKey,
    sourceKey: metricsDto.sourceKey,
    definitionVersion: metricsDto.definitionVersion,
    lifecycleMode: source.lifecycleMode,
    policy: {
      autoPublishTrusted: source.autoPublishTrusted,
      canRepublishPublicly: source.canRepublishPublicly,
      canFetchAuthenticated: source.canFetchAuthenticated,
    },
    evidence,
    eligibility,
  };
}
