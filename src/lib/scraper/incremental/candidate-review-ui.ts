/**
 * PURE, client-safe candidate-review UI helpers (issue #1100, Phase 3.1).
 *
 * Owns the presentation contract for the admin candidate-review queue WITHOUT
 * any React/DOM/network: the client DTO shapes (dates arrive as ISO strings over
 * the wire), the status/provenance/conflict label + badge maps, the review-action
 * legality MIRROR (`availableReviewActions` — which per-row buttons render, kept
 * in lock-step with `candidate-review-policy.ts`), and the mutation-outcome
 * classification (idempotent no-op, stale, illegal, partial-batch) the UI must
 * surface. Every value here is a sanitized id, status, count, timestamp, or reason
 * CATEGORY — never a URL, body, secret, or article content.
 */
import { ApiResponseError } from "@/lib/client-fetch";
import type {
  CandidateReviewAction,
  CandidateReviewIllegalReason,
  CandidateReviewNoopReason,
} from "@/lib/scraper/incremental/candidate-review-policy";
import { REASON_REQUIRED_ACTIONS } from "@/lib/scraper/incremental/candidate-review-policy";

// Re-exported so the client components have a single import surface.
export type { CandidateReviewAction } from "@/lib/scraper/incremental/candidate-review-policy";
export { REASON_REQUIRED_ACTIONS } from "@/lib/scraper/incremental/candidate-review-policy";

/** The shared `Badge` tone union — kept local so this module stays free of the
 * component graph (it is imported by pure Node tests). Mirrors `BadgeProps["variant"]`. */
export type BadgeVariant = "neutral" | "primary" | "success" | "warning" | "danger";

// ---------------------------------------------------------------------------
// Client DTO shapes (dates serialize to ISO strings over the JSON API)
// ---------------------------------------------------------------------------

/** A single sanitized review-candidate row as delivered by the JSON API. */
export type ReviewCandidate = {
  id: string;
  providerKey: string;
  discoverySourceId: string | null;
  identityVersion: number;
  provisionalKey: string;
  canonicalKey: string | null;
  status: string;
  observedInBaseline: boolean;
  firstObservedAt: string;
  lastObservedAt: string;
  observationCount: number;
  reviewReason: string | null;
  terminalAt: string | null;
  dateProvenance: string;
  trustedPublishedAt: string | null;
  lastFailureReason: string | null;
  ingestAttemptCount: number;
  hasArticle: boolean;
};

/** A sanitized canonical-conflict summary shown in the detail view. */
export type ReviewConflict = {
  id: string;
  status: string;
  reason: string | null;
  detectedAt: string;
  resolvedAt: string | null;
};

/** The candidate detail DTO adds the conflict history. */
export type ReviewCandidateDetail = ReviewCandidate & {
  conflicts: ReviewConflict[];
};

/** A bounded, filtered page of review candidates + the total match count. */
export type ReviewCandidatePage = {
  candidates: ReviewCandidate[];
  total: number;
  offset: number;
  limit: number;
};

/** The two operator-facing review statuses the queue filters on. */
export const REVIEW_QUEUE_STATUSES = ["NEEDS_REVIEW", "SKIPPED_REVIEW"] as const;
export type ReviewQueueStatus = (typeof REVIEW_QUEUE_STATUSES)[number];

/** Default page size, matching the API default/cap (1–200, default 50). */
export const DEFAULT_REVIEW_LIMIT = 50;
export const MAX_REVIEW_LIMIT = 200;
/** Max candidates per bounded batch, matching the API. */
export const MAX_REVIEW_BATCH = 100;

export function isReviewQueueStatus(value: string): value is ReviewQueueStatus {
  return (REVIEW_QUEUE_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Labels + badges (sanitized categories only)
// ---------------------------------------------------------------------------

/** Human labels for the review-queue status filter segments. */
export const REVIEW_QUEUE_STATUS_LABELS: Record<ReviewQueueStatus, string> = {
  NEEDS_REVIEW: "Needs review",
  SKIPPED_REVIEW: "Rejected",
};

/** Badge tone + label per candidate status surfaced in the queue/detail. */
const CANDIDATE_STATUS_BADGE: Record<string, { variant: BadgeVariant; label: string }> = {
  NEEDS_REVIEW: { variant: "warning", label: "Needs review" },
  SKIPPED_REVIEW: { variant: "neutral", label: "Rejected" },
  QUEUED: { variant: "primary", label: "Queued" },
  INGESTING: { variant: "primary", label: "Ingesting" },
  INGESTED: { variant: "success", label: "Ingested" },
  REJECTED: { variant: "danger", label: "Rejected (410)" },
  CONFLICT: { variant: "warning", label: "Conflict" },
  QUARANTINED: { variant: "danger", label: "Quarantined" },
};

export function candidateStatusBadge(status: string): { variant: BadgeVariant; label: string } {
  return CANDIDATE_STATUS_BADGE[status] ?? { variant: "neutral", label: status };
}

/** Human labels for the candidate publication-date provenance. */
const DATE_PROVENANCE_LABELS: Record<string, string> = {
  UNKNOWN: "Unknown",
  FEED: "Feed",
  PAGE_METADATA: "Page metadata",
  URL: "URL-derived",
  HTTP_HEADER: "HTTP header",
  INFERRED: "Inferred",
};

export function dateProvenanceLabel(provenance: string): string {
  return DATE_PROVENANCE_LABELS[provenance] ?? provenance;
}

/** Badge tone per canonical-conflict status shown in the detail view. */
const CONFLICT_STATUS_BADGE: Record<string, { variant: BadgeVariant; label: string }> = {
  OPEN: { variant: "warning", label: "Open" },
  RESOLVED: { variant: "success", label: "Resolved" },
  DISMISSED: { variant: "neutral", label: "Dismissed" },
};

export function conflictStatusBadge(status: string): { variant: BadgeVariant; label: string } {
  return CONFLICT_STATUS_BADGE[status] ?? { variant: "neutral", label: status };
}

// ---------------------------------------------------------------------------
// Review action metadata + legality mirror
// ---------------------------------------------------------------------------

/** Verb labels for the three review actions. */
export const REVIEW_ACTION_LABELS: Record<CandidateReviewAction, string> = {
  approve: "Approve",
  reject: "Reject",
  reactivate: "Reactivate",
};

/** Past-tense labels for confirmation copy. */
export const REVIEW_ACTION_PAST_LABELS: Record<CandidateReviewAction, string> = {
  approve: "Approved",
  reject: "Rejected",
  reactivate: "Reactivated",
};

/** Resting button variant per review action. */
export const REVIEW_ACTION_VARIANT: Record<CandidateReviewAction, "primary" | "danger"> = {
  approve: "primary",
  reject: "danger",
  reactivate: "primary",
};

/** True when the action requires an audit reason (reject / reactivate). */
export function reviewActionNeedsReason(action: CandidateReviewAction): boolean {
  return REASON_REQUIRED_ACTIONS.includes(action);
}

/**
 * The per-row actions an operator may take, MIRRORING `decideCandidateReview`:
 * a linked Article hard-blocks everything; a NEEDS_REVIEW candidate can be
 * approved or rejected; a rejected (SKIPPED_REVIEW) candidate can only be
 * reactivated. Any already-decided state offers nothing actionable.
 */
export function availableReviewActions(status: string, hasArticle: boolean): CandidateReviewAction[] {
  if (hasArticle) return [];
  if (status === "NEEDS_REVIEW") return ["approve", "reject"];
  if (status === "SKIPPED_REVIEW") return ["reactivate"];
  return [];
}

/** The batch actions offered while viewing a given queue status. */
export function batchActionsForStatus(status: ReviewQueueStatus): CandidateReviewAction[] {
  return status === "NEEDS_REVIEW" ? ["approve", "reject"] : ["reactivate"];
}

/** Why a candidate row cannot be acted on (tooltip copy). Null when actionable. */
export function blockedActionReason(candidate: Pick<ReviewCandidate, "hasArticle" | "status">): string | null {
  if (candidate.hasArticle) {
    return "Linked to a public article — the governing invariant blocks all review actions.";
  }
  if (availableReviewActions(candidate.status, candidate.hasArticle).length === 0) {
    return "No review action is available from this candidate's current state.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Idempotent no-op / illegal reason copy
// ---------------------------------------------------------------------------

const NOOP_REASON_LABELS: Record<CandidateReviewNoopReason, string> = {
  "already-approved": "Already approved",
  "already-rejected": "Already rejected",
  "already-in-review": "Already in review",
};

export function noopReasonLabel(reason: string): string {
  return NOOP_REASON_LABELS[reason as CandidateReviewNoopReason] ?? reason;
}

const ILLEGAL_DETAIL_LABELS: Record<CandidateReviewIllegalReason, string> = {
  "has-article": "Linked to a public article",
  "not-reviewable": "Not reviewable from its current state",
  "not-rejected": "Not rejected — cannot reactivate",
};

export function illegalDetailLabel(detail: string): string {
  return ILLEGAL_DETAIL_LABELS[detail as CandidateReviewIllegalReason] ?? detail;
}

// ---------------------------------------------------------------------------
// Individual-action mutation outcome classification
// ---------------------------------------------------------------------------

/** The classified outcome of a single review mutation (thrown or resolved). */
export type ReviewMutationError =
  | { kind: "stale"; message: string }
  | { kind: "illegal"; detail: string; message: string }
  | { kind: "notFound"; message: string }
  | { kind: "validation"; message: string }
  | { kind: "auth"; message: string }
  | { kind: "generic"; message: string };

function errorBodyReason(body: unknown): { reason?: string; detail?: string; stale?: boolean } {
  if (body && typeof body === "object") {
    const b = body as { reason?: unknown; detail?: unknown; stale?: unknown };
    return {
      reason: typeof b.reason === "string" ? b.reason : undefined,
      detail: typeof b.detail === "string" ? b.detail : undefined,
      stale: b.stale === true,
    };
  }
  return {};
}

/** Maps a mutation HTTP status + server body to a {@link ReviewMutationError}. PURE. */
export function reviewMutationErrorFrom(
  status: number | null,
  body: unknown,
  message: string,
): ReviewMutationError {
  const { reason } = errorBodyReason(body);
  if (status === 409 && reason === "stale") return { kind: "stale", message };
  if (status === 409 && reason === "illegal") {
    const { detail } = errorBodyReason(body);
    return { kind: "illegal", detail: detail ?? "not-reviewable", message };
  }
  if (status === 404) return { kind: "notFound", message };
  if (status === 400) return { kind: "validation", message };
  if (status === 401 || status === 403) return { kind: "auth", message };
  return { kind: "generic", message };
}

/** Classifies a caught single-action error into a {@link ReviewMutationError}. */
export function classifyReviewMutationError(err: unknown): ReviewMutationError {
  if (err instanceof ApiResponseError) {
    return reviewMutationErrorFrom(err.status, err.cause, err.message);
  }
  const message = err instanceof Error ? err.message : "Review action failed.";
  return reviewMutationErrorFrom(null, null, message);
}

// ---------------------------------------------------------------------------
// Partial-batch response shaping (HTTP is always 200 — per-item outcomes)
// ---------------------------------------------------------------------------

/** One per-item result inside the bounded-batch response. */
export type BatchResultItem =
  | { candidateId: string; ok: true; outcome: "applied"; fromStatus: string; toStatus: string; enqueued: boolean }
  | { candidateId: string; ok: true; outcome: "noop"; reason: string; status: string }
  | { candidateId: string; ok: false; reason: "illegal"; detail: string; status: string }
  | { candidateId: string; ok: false; reason: "stale"; stale: true; status: string }
  | { candidateId: string; ok: false; reason: "not-found" };

/** The always-200 bounded-batch response body. */
export type BatchReviewResponse = {
  ok: true;
  action: CandidateReviewAction;
  results: BatchResultItem[];
  summary: { total: number; applied: number; noop: number; failed: number };
};

/** Presentation tone + one-line copy for a single batch item. */
export function describeBatchItem(item: BatchResultItem): { tone: BadgeVariant; label: string } {
  if (item.ok && item.outcome === "applied") {
    return { tone: "success", label: item.enqueued ? "Applied — queued for ingest" : "Applied" };
  }
  if (item.ok) return { tone: "neutral", label: noopReasonLabel(item.reason) };
  if (item.reason === "illegal") return { tone: "danger", label: `Blocked — ${illegalDetailLabel(item.detail)}` };
  if (item.reason === "stale") return { tone: "warning", label: "Changed concurrently — refresh & retry" };
  return { tone: "neutral", label: "Not found" };
}

/** True when any item in the batch was rejected as stale (prompt a refetch). */
export function batchHasStale(response: BatchReviewResponse): boolean {
  return response.results.some((item) => !item.ok && item.reason === "stale");
}

/** A compact human summary of a completed batch. */
export function summarizeBatch(response: BatchReviewResponse): string {
  const { total, applied, noop, failed } = response.summary;
  const verb = REVIEW_ACTION_LABELS[response.action].toLowerCase();
  return `${verb}: ${applied} applied · ${noop} no-op · ${failed} failed of ${total}`;
}

// ---------------------------------------------------------------------------
// Individual-action success response shaping
// ---------------------------------------------------------------------------

/** The 200 response body for a single review action. */
export type SingleReviewResponse =
  | {
      ok: true;
      outcome: "applied";
      action: CandidateReviewAction;
      candidateId: string;
      fromStatus: string;
      toStatus: string;
      enqueued: boolean;
    }
  | {
      ok: true;
      outcome: "noop";
      action: CandidateReviewAction;
      candidateId: string;
      reason: string;
      status: string;
    };

/** A human sentence describing a single review outcome (applied vs no-op). */
export function describeSingleReview(res: SingleReviewResponse): string {
  const past = REVIEW_ACTION_PAST_LABELS[res.action];
  if (res.outcome === "applied") {
    return res.enqueued ? `${past} — queued for ingest.` : `${past}.`;
  }
  return `No change — ${noopReasonLabel(res.reason).toLowerCase()}.`;
}
