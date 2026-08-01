/**
 * PURE, client-safe source-trust UI helpers (issue #1100, Phase 3.1).
 *
 * Presentation contract for the admin source-trust promotion panel: the client
 * DTO shapes, the evidence/drift formatting, the blocker/warning label maps, and
 * the promote/demote mutation-outcome classification (version-mismatch, busy,
 * ineligible + blockers, stale). No React/DOM/network. Every value is a sanitized
 * count, rate, enum, or reason CATEGORY — never a credential, URL, or content.
 */
import { ApiResponseError, clientErrorMessage } from "@/lib/client-fetch";
import type { BadgeVariant } from "@/lib/scraper/incremental/candidate-review-ui";

// ---------------------------------------------------------------------------
// Client DTO shapes (mirror source-trust-query.ts + source-trust-policy.ts)
// ---------------------------------------------------------------------------

export type SourceTrustPolicySnapshot = {
  autoPublishTrusted: boolean;
  canRepublishPublicly: boolean;
  canFetchAuthenticated: boolean;
};

export type SourceTrustDriftSignals = {
  zeroDiscoveryStreak: number;
  consecutiveFailures: number;
  volumeAnomaly: "none" | "spike" | "drop";
  conflictRate: number | null;
  oldItemFalsePositives: number;
};

export type SourceTrustEvidence = {
  sampleSize: number;
  acceptedCount: number;
  reviewRejectedCount: number;
  decidedCount: number;
  approvalRate: number | null;
  oldItemFalsePositives: number;
  oldItemFalsePositiveRate: number | null;
  drift: SourceTrustDriftSignals;
};

export type SourceTrustBlocker =
  | "insufficient-sample"
  | "insufficient-decisions"
  | "low-approval-rate"
  | "old-item-false-positive"
  | "active-drift";

export type SourceTrustWarning =
  | "volume-anomaly"
  | "elevated-conflict-rate"
  | "recent-failures";

export type SourceTrustEligibility = {
  eligible: boolean;
  blockers: SourceTrustBlocker[];
  warnings: SourceTrustWarning[];
  evidence: SourceTrustEvidence;
};

export type SourceTrustSnapshot = {
  id: string;
  providerKey: string;
  sourceKey: string;
  definitionVersion: number;
  lifecycleMode: string;
  policy: SourceTrustPolicySnapshot;
  evidence: SourceTrustEvidence;
  eligibility: SourceTrustEligibility;
};

export type SourceTrustAction = "promote" | "demote";

/** The 200 promote/demote response body. */
export type SourceTrustCommitResponse = {
  ok: true;
  action: SourceTrustAction;
  changed: boolean;
  definitionVersion: number;
  before: boolean;
  after: boolean;
  toMode?: string;
};

// ---------------------------------------------------------------------------
// Blocker / warning label maps (sanitized categories)
// ---------------------------------------------------------------------------

export const TRUST_BLOCKER_LABELS: Record<SourceTrustBlocker, string> = {
  "insufficient-sample": "Not enough observed candidates yet",
  "insufficient-decisions": "Not enough reviewed decisions yet",
  "low-approval-rate": "Approval rate below the promotion bar",
  "old-item-false-positive": "A pre-baseline item was accepted into work (governing-invariant violation)",
  "active-drift": "Active drift or anomaly detected",
};

export function trustBlockerLabel(blocker: string): string {
  return TRUST_BLOCKER_LABELS[blocker as SourceTrustBlocker] ?? blocker;
}

export const TRUST_WARNING_LABELS: Record<SourceTrustWarning, string> = {
  "volume-anomaly": "Discovery-volume anomaly",
  "elevated-conflict-rate": "Elevated canonical-conflict rate",
  "recent-failures": "Recent run failures",
};

export function trustWarningLabel(warning: string): string {
  return TRUST_WARNING_LABELS[warning as SourceTrustWarning] ?? warning;
}

const VOLUME_ANOMALY_LABELS: Record<string, string> = {
  none: "None",
  spike: "Spike",
  drop: "Drop",
};

export function volumeAnomalyLabel(anomaly: string): string {
  return VOLUME_ANOMALY_LABELS[anomaly] ?? anomaly;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const DASH = "—";

/** Formats a 0..1 rate as a 1-decimal percentage, or "—" when null. PURE. */
export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return DASH;
  return `${(rate * 100).toFixed(1)}%`;
}

/** Trust-status badge tone + label for the current auto-publish flag. */
export function trustStatusBadge(autoPublishTrusted: boolean): { variant: BadgeVariant; label: string } {
  return autoPublishTrusted
    ? { variant: "success", label: "Trusted (auto-publish)" }
    : { variant: "neutral", label: "Untrusted" };
}

/** True when the old-item-false-positive tripwire has fired (zero-tolerance). */
export function hasOldItemFalsePositive(evidence: SourceTrustEvidence): boolean {
  return evidence.oldItemFalsePositives > 0;
}

/**
 * Whether the promote control should be enabled: the reported eligibility must
 * be clear AND the source must not already be trusted. Demote is enabled only
 * when the source IS currently trusted.
 */
export function canPromote(snapshot: SourceTrustSnapshot): boolean {
  return snapshot.eligibility.eligible && !snapshot.policy.autoPublishTrusted;
}

export function canDemote(snapshot: SourceTrustSnapshot): boolean {
  return snapshot.policy.autoPublishTrusted;
}

// ---------------------------------------------------------------------------
// Promote / demote mutation outcome classification
// ---------------------------------------------------------------------------

export type TrustMutationError =
  | { kind: "versionMismatch"; message: string }
  | { kind: "busy"; message: string }
  | { kind: "ineligible"; blockers: SourceTrustBlocker[]; message: string }
  | { kind: "stale"; message: string }
  | { kind: "notFound"; message: string }
  | { kind: "validation"; message: string }
  | { kind: "auth"; message: string }
  | { kind: "generic"; message: string };

function bodyReason(body: unknown): { reason?: string; blockers?: string[] } {
  if (body && typeof body === "object") {
    const b = body as { reason?: unknown; blockers?: unknown };
    return {
      reason: typeof b.reason === "string" ? b.reason : undefined,
      blockers: Array.isArray(b.blockers)
        ? b.blockers.filter((x): x is string => typeof x === "string")
        : undefined,
    };
  }
  return {};
}

/** Maps a promote/demote HTTP status + server body to a {@link TrustMutationError}. PURE. */
export function trustMutationErrorFrom(
  status: number | null,
  body: unknown,
  message: string,
): TrustMutationError {
  const { reason, blockers } = bodyReason(body);
  if (status === 409 && reason === "version-mismatch") return { kind: "versionMismatch", message };
  if (status === 409 && reason === "busy") return { kind: "busy", message };
  if (status === 409 && reason === "ineligible") {
    return { kind: "ineligible", blockers: (blockers ?? []) as SourceTrustBlocker[], message };
  }
  if (status === 409 && reason === "stale") return { kind: "stale", message };
  if (status === 404) return { kind: "notFound", message };
  if (status === 400) return { kind: "validation", message };
  if (status === 401 || status === 403) return { kind: "auth", message };
  return { kind: "generic", message };
}

/** Classifies a caught promote/demote error into a {@link TrustMutationError}. */
export function classifyTrustMutationError(err: unknown): TrustMutationError {
  if (err instanceof ApiResponseError) {
    return trustMutationErrorFrom(err.status, err.cause, err.message);
  }
  const message = clientErrorMessage(err, "Trust action failed.");
  return trustMutationErrorFrom(null, null, message);
}
