/**
 * PURE source-trust promotion/demotion policy (issue #1100, Phase 3.1).
 *
 * Explicit trust promotion lets an operator turn a proven sitemap/HTML source's
 * automation on (`autoPublishTrusted`) WITHOUT any automatic escalation. This
 * module owns the metadata-only decision surface:
 *
 *   1. {@link computeSourceTrustEvidence} — rolls candidate status counts + drift
 *      signals into the sanitized evidence summary the UI renders (sample size,
 *      approval rate, old-item false-positive rate, drift evidence). Counts only —
 *      never a URL/body/secret.
 *   2. {@link decideSourceTrustEligibility} — REPORTS whether the evidence clears
 *      the promotion bar. It NEVER promotes; it only says "eligible" + surfaces
 *      hard blockers and soft warnings. The operator's explicit action promotes.
 *   3. {@link decideSourceTrustDemotion} — the drift/anomaly rule that AUTO-DEMOTES
 *      an already-promoted source back to review/shadow. Records every triggering
 *      reason so the demotion evidence is auditable; it demotes the trust FLAG and
 *      asks the caller to roll ACTIVE→SHADOW, but NEVER deletes candidate history.
 *
 * PURE + deterministic like `degradation.ts` / `rollout-gates.ts`: takes plain
 * inputs (counts, flags, `VolumeAnomaly`), no DB/network/clock. The thin
 * `source-trust-commit.ts` applies decisions under a guarded transaction.
 *
 * Governing invariant tie-in: an "old-item false positive" — a pre-baseline
 * identity (`observedInBaseline`) that was nonetheless accepted into work — is a
 * HARD, zero-tolerance promotion blocker AND an immediate auto-demotion trigger.
 * A source that has EVER refetched a known/old item can never be trusted to
 * automate.
 */
import { CrawlCandidateStatus } from "@prisma/client";

import type { CandidateStatusCounts, VolumeAnomaly } from "./observability";

const S = CrawlCandidateStatus;

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** Drift signals folded into the trust evidence + demotion decision (counts/enums only). */
export type SourceTrustDriftSignals = {
  /** Consecutive successful runs discovering zero new identities. */
  zeroDiscoveryStreak: number;
  /** Consecutive hard run failures. */
  consecutiveFailures: number;
  /** Discovery-volume anomaly classification. */
  volumeAnomaly: VolumeAnomaly;
  /** CONFLICT / total candidates (sanitized rate); null when no candidates. */
  conflictRate: number | null;
  /**
   * Count of pre-baseline (`observedInBaseline`) identities that were nonetheless
   * accepted into work — a governing-invariant violation. HARD-ZERO expected.
   */
  oldItemFalsePositives: number;
};

/** The sanitized, metadata-only trust evidence summary the UI renders. */
export type SourceTrustEvidence = {
  /** Total candidates observed for this source/version. */
  sampleSize: number;
  /** Candidates accepted into work (QUEUED + INGESTING + INGESTED). */
  acceptedCount: number;
  /** Candidates rejected in review (SKIPPED_REVIEW). */
  reviewRejectedCount: number;
  /** Candidates that reached an explicit review decision (accepted + rejected). */
  decidedCount: number;
  /** acceptedCount / decidedCount; null when nothing has been decided yet. */
  approvalRate: number | null;
  /** Pre-baseline identities that became work (governing-invariant violations). */
  oldItemFalsePositives: number;
  /** oldItemFalsePositives / acceptedCount; null when nothing accepted. */
  oldItemFalsePositiveRate: number | null;
  /** Drift evidence surfaced verbatim for the operator decision. */
  drift: SourceTrustDriftSignals;
};

/** Inputs to {@link computeSourceTrustEvidence}. */
export type SourceTrustEvidenceInput = {
  candidateCounts: CandidateStatusCounts;
  drift: SourceTrustDriftSignals;
};

function count(counts: CandidateStatusCounts, status: CrawlCandidateStatus): number {
  return counts[status] ?? 0;
}

/**
 * Rolls candidate status counts + drift signals into the sanitized evidence
 * summary. PURE. `acceptedCount` (QUEUED+INGESTING+INGESTED) is the "accepted
 * into work" tally and `reviewRejectedCount` (SKIPPED_REVIEW) the review
 * rejections; `approvalRate` is over their sum (candidates that reached a
 * decision), and is `null` before any decision exists.
 */
export function computeSourceTrustEvidence(
  input: SourceTrustEvidenceInput,
): SourceTrustEvidence {
  const { candidateCounts, drift } = input;

  const sampleSize = Object.values(candidateCounts).reduce((sum, n) => sum + (n ?? 0), 0);
  const acceptedCount =
    count(candidateCounts, S.QUEUED) +
    count(candidateCounts, S.INGESTING) +
    count(candidateCounts, S.INGESTED);
  const reviewRejectedCount = count(candidateCounts, S.SKIPPED_REVIEW);
  const decidedCount = acceptedCount + reviewRejectedCount;

  return {
    sampleSize,
    acceptedCount,
    reviewRejectedCount,
    decidedCount,
    approvalRate: decidedCount > 0 ? acceptedCount / decidedCount : null,
    oldItemFalsePositives: drift.oldItemFalsePositives,
    oldItemFalsePositiveRate:
      acceptedCount > 0 ? drift.oldItemFalsePositives / acceptedCount : null,
    drift,
  };
}

// ---------------------------------------------------------------------------
// Promotion eligibility (REPORT ONLY — never auto-promotes)
// ---------------------------------------------------------------------------

/** Provider-tunable promotion thresholds. */
export type SourceTrustThresholds = {
  /** Minimum sample size before a source can be judged (default 20). */
  minSampleSize: number;
  /** Minimum decided-candidate count before approval rate is meaningful (default 10). */
  minDecidedCount: number;
  /** Minimum approval rate to clear the bar (default 0.8). */
  minApprovalRate: number;
  /** Max tolerated old-item false positives (default 0 — hard zero). */
  maxOldItemFalsePositives: number;
  /** Zero-discovery streak at/above which promotion is blocked (default 3). */
  driftZeroDiscoveryStreak: number;
  /** Consecutive failures at/above which promotion is blocked (default 3). */
  driftConsecutiveFailures: number;
  /** Conflict rate at/above which promotion is blocked (default 0.1). */
  driftConflictRate: number;
};

/** Default promotion thresholds. */
export const DEFAULT_SOURCE_TRUST_THRESHOLDS: SourceTrustThresholds = {
  minSampleSize: 20,
  minDecidedCount: 10,
  minApprovalRate: 0.8,
  maxOldItemFalsePositives: 0,
  driftZeroDiscoveryStreak: 3,
  driftConsecutiveFailures: 3,
  driftConflictRate: 0.1,
};

/** Hard reasons that BLOCK promotion (sanitized categories). */
export type SourceTrustBlocker =
  | "insufficient-sample"
  | "insufficient-decisions"
  | "low-approval-rate"
  | "old-item-false-positive"
  | "active-drift";

/** Soft concerns surfaced to the operator but which do NOT block promotion. */
export type SourceTrustWarning =
  | "volume-anomaly"
  | "elevated-conflict-rate"
  | "recent-failures";

/** The eligibility REPORT — never an action. */
export type SourceTrustEligibility = {
  /** True only when there are zero hard blockers. */
  eligible: boolean;
  blockers: SourceTrustBlocker[];
  warnings: SourceTrustWarning[];
  evidence: SourceTrustEvidence;
};

/**
 * REPORTS whether the evidence clears the promotion bar. This function NEVER
 * promotes and has no side effects — it only classifies blockers (hard) and
 * warnings (soft). The operator's explicit promote action is what flips trust on
 * (issue: "NEVER auto-promote based on metrics alone").
 *
 * An old-item false positive (a pre-baseline identity that became work) is a
 * hard, zero-tolerance blocker — the governing invariant forbids it, so a source
 * that ever did it can never be trusted regardless of any other metric.
 */
export function decideSourceTrustEligibility(
  evidence: SourceTrustEvidence,
  thresholds: SourceTrustThresholds = DEFAULT_SOURCE_TRUST_THRESHOLDS,
): SourceTrustEligibility {
  const blockers: SourceTrustBlocker[] = [];
  const warnings: SourceTrustWarning[] = [];

  if (evidence.oldItemFalsePositives > thresholds.maxOldItemFalsePositives) {
    blockers.push("old-item-false-positive");
  }
  if (evidence.sampleSize < thresholds.minSampleSize) {
    blockers.push("insufficient-sample");
  }
  if (evidence.decidedCount < thresholds.minDecidedCount) {
    blockers.push("insufficient-decisions");
  } else if (
    evidence.approvalRate !== null &&
    evidence.approvalRate < thresholds.minApprovalRate
  ) {
    blockers.push("low-approval-rate");
  }

  const driftActive =
    evidence.drift.zeroDiscoveryStreak >= thresholds.driftZeroDiscoveryStreak ||
    evidence.drift.consecutiveFailures >= thresholds.driftConsecutiveFailures ||
    (evidence.drift.conflictRate !== null &&
      evidence.drift.conflictRate >= thresholds.driftConflictRate) ||
    evidence.drift.volumeAnomaly === "spike" ||
    evidence.drift.volumeAnomaly === "drop";
  if (driftActive) blockers.push("active-drift");

  if (evidence.drift.volumeAnomaly === "spike" || evidence.drift.volumeAnomaly === "drop") {
    warnings.push("volume-anomaly");
  }
  if (
    evidence.drift.conflictRate !== null &&
    evidence.drift.conflictRate >= thresholds.driftConflictRate
  ) {
    warnings.push("elevated-conflict-rate");
  }
  if (evidence.drift.consecutiveFailures > 0) {
    warnings.push("recent-failures");
  }

  return { eligible: blockers.length === 0, blockers, warnings, evidence };
}

// ---------------------------------------------------------------------------
// Drift-driven auto-demotion (anomaly → return promoted source to review/shadow)
// ---------------------------------------------------------------------------

/** Configurable anomaly thresholds that auto-demote a promoted source. */
export type SourceTrustDemotionThresholds = {
  /** Zero-discovery streak at/above which a promoted source is demoted (default 8). */
  maxZeroDiscoveryStreak: number;
  /** Consecutive failures at/above which a promoted source is demoted (default 3). */
  maxConsecutiveFailures: number;
  /** Conflict rate at/above which a promoted source is demoted (default 0.2). */
  maxConflictRate: number;
  /** Max tolerated old-item false positives (default 0 — hard zero). */
  maxOldItemFalsePositives: number;
  /** Whether a spike/drop volume anomaly auto-demotes (default true). */
  demoteOnVolumeAnomaly: boolean;
};

/** Default auto-demotion thresholds (deliberately above the promotion-block bar). */
export const DEFAULT_SOURCE_TRUST_DEMOTION_THRESHOLDS: SourceTrustDemotionThresholds = {
  maxZeroDiscoveryStreak: 8,
  maxConsecutiveFailures: 3,
  maxConflictRate: 0.2,
  maxOldItemFalsePositives: 0,
  demoteOnVolumeAnomaly: true,
};

/** Why an auto-demotion fired (sanitized categories; multiple may apply). */
export type SourceTrustDemotionReason =
  | "old-item-false-positive"
  | "zero-discovery-drift"
  | "repeated-failures"
  | "volume-anomaly"
  | "elevated-conflict-rate";

/** The auto-demotion decision. `demote` lists EVERY triggering reason for audit. */
export type SourceTrustDemotionDecision = {
  action: "keep" | "demote";
  reasons: SourceTrustDemotionReason[];
};

/**
 * Decides whether a currently-trusted source has drifted enough to be
 * automatically demoted (trust flag revoked + ACTIVE→SHADOW). PURE. Only sources
 * that are actually trusted are evaluated (`isTrusted` guard) — an untrusted
 * source has no trust to revoke. Records ALL triggering reasons so the audit
 * evidence is complete. The caller applies the flag change + lifecycle rollback
 * WITHOUT ever deleting candidate history (AC3).
 */
export function decideSourceTrustDemotion(
  input: {
    isTrusted: boolean;
    drift: SourceTrustDriftSignals;
  },
  thresholds: SourceTrustDemotionThresholds = DEFAULT_SOURCE_TRUST_DEMOTION_THRESHOLDS,
): SourceTrustDemotionDecision {
  if (!input.isTrusted) return { action: "keep", reasons: [] };

  const { drift } = input;
  const reasons: SourceTrustDemotionReason[] = [];

  if (drift.oldItemFalsePositives > thresholds.maxOldItemFalsePositives) {
    reasons.push("old-item-false-positive");
  }
  if (drift.zeroDiscoveryStreak >= thresholds.maxZeroDiscoveryStreak) {
    reasons.push("zero-discovery-drift");
  }
  if (drift.consecutiveFailures >= thresholds.maxConsecutiveFailures) {
    reasons.push("repeated-failures");
  }
  if (
    thresholds.demoteOnVolumeAnomaly &&
    (drift.volumeAnomaly === "spike" || drift.volumeAnomaly === "drop")
  ) {
    reasons.push("volume-anomaly");
  }
  if (drift.conflictRate !== null && drift.conflictRate >= thresholds.maxConflictRate) {
    reasons.push("elevated-conflict-rate");
  }

  return { action: reasons.length > 0 ? "demote" : "keep", reasons };
}
