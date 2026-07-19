/**
 * PURE candidate-review transition policy (issue #1100, Phase 3.1).
 *
 * Decides whether an operator's approve / reject / reactivate action on a
 * NEEDS_REVIEW candidate is a legal transition, an idempotent no-op, or illegal
 * — WITHOUT touching the database, network, or clock (pure-logic house style,
 * mirroring `classify.ts` / `credential-policy.ts` / `rollout-gates.ts`). The
 * thin `candidate-review-commit.ts` applies the returned decision under a guarded
 * transaction; this module owns the state-machine legality only.
 *
 * Review state machine (a NEEDS_REVIEW candidate is parked BEFORE any Article,
 * with `articleId === null` — the governing invariant forbids ever touching a
 * KNOWN public Article, so `hasArticle` hard-blocks every action):
 *
 *   NEEDS_REVIEW --approve----> QUEUED           (+ normal candidate ingest job)
 *   NEEDS_REVIEW --reject-----> SKIPPED_REVIEW   (terminal; never rediscovered)
 *   SKIPPED_REVIEW --reactivate--> NEEDS_REVIEW  (separate audited action only)
 *
 * Idempotency (AC1 — "approving the same candidate twice creates ONE active
 * Job"): a repeated approve on an already-accepted candidate (QUEUED / INGESTING
 * / INGESTED) is a no-op that enqueues NOTHING, so the single job created by the
 * first approve is the only one. Reject/reactivate are idempotent the same way.
 * Reject records SKIPPED_REVIEW, which ordinary rediscovery/ingest never revives
 * (the classifier routes any known identity to `existing-identity`); it returns
 * to review ONLY through the explicit `reactivate` action.
 */
import { CrawlCandidateStatus } from "@prisma/client";

/** The three operator review actions. */
export const CANDIDATE_REVIEW_ACTIONS = ["approve", "reject", "reactivate"] as const;
export type CandidateReviewAction = (typeof CANDIDATE_REVIEW_ACTIONS)[number];

/** Actions that are policy-sensitive and therefore REQUIRE an audit reason. */
export const REASON_REQUIRED_ACTIONS: readonly CandidateReviewAction[] = ["reject", "reactivate"];

/** Idempotent no-op reason codes (the action was already effectively applied). */
export type CandidateReviewNoopReason =
  | "already-approved"
  | "already-rejected"
  | "already-in-review";

/** Illegal-transition reason codes (sanitized categories — never content). */
export type CandidateReviewIllegalReason =
  | "has-article"
  | "not-reviewable"
  | "not-rejected";

/** The status a successful transition moves the candidate to. */
export type CandidateReviewTargetStatus = CrawlCandidateStatus;

/** Outcome of {@link decideCandidateReview}. */
export type CandidateReviewDecision =
  | {
      kind: "apply";
      action: CandidateReviewAction;
      fromStatus: CrawlCandidateStatus;
      toStatus: CandidateReviewTargetStatus;
      /** Only an `approve` routes the candidate into the normal ingest pipeline. */
      enqueueIngest: boolean;
    }
  | {
      kind: "noop";
      action: CandidateReviewAction;
      reason: CandidateReviewNoopReason;
      status: CrawlCandidateStatus;
    }
  | {
      kind: "illegal";
      action: CandidateReviewAction;
      reason: CandidateReviewIllegalReason;
      status: CrawlCandidateStatus;
    };

/** Inputs the pure decision reads — all metadata, no identities/URLs. */
export type CandidateReviewInput = {
  action: CandidateReviewAction;
  status: CrawlCandidateStatus;
  /** True when the candidate already links a public Article (hard-blocks all). */
  hasArticle: boolean;
};

const S = CrawlCandidateStatus;

/** Statuses that count as "already accepted into the ingest pipeline". */
const ACCEPTED_STATUSES: readonly CrawlCandidateStatus[] = [S.QUEUED, S.INGESTING, S.INGESTED];

function apply(
  action: CandidateReviewAction,
  fromStatus: CrawlCandidateStatus,
  toStatus: CandidateReviewTargetStatus,
  enqueueIngest: boolean,
): CandidateReviewDecision {
  return { kind: "apply", action, fromStatus, toStatus, enqueueIngest };
}

function noop(
  action: CandidateReviewAction,
  reason: CandidateReviewNoopReason,
  status: CrawlCandidateStatus,
): CandidateReviewDecision {
  return { kind: "noop", action, reason, status };
}

function illegal(
  action: CandidateReviewAction,
  reason: CandidateReviewIllegalReason,
  status: CrawlCandidateStatus,
): CandidateReviewDecision {
  return { kind: "illegal", action, reason, status };
}

/**
 * Decides the legality + idempotency of one review action. Deterministic and
 * side-effect free. A candidate with a linked Article can NEVER be mutated by any
 * review action (governing invariant), so `hasArticle` short-circuits first.
 */
export function decideCandidateReview(input: CandidateReviewInput): CandidateReviewDecision {
  const { action, status, hasArticle } = input;

  if (hasArticle) return illegal(action, "has-article", status);

  switch (action) {
    case "approve":
      if (status === S.NEEDS_REVIEW) return apply(action, status, S.QUEUED, true);
      if (ACCEPTED_STATUSES.includes(status)) return noop(action, "already-approved", status);
      // SKIPPED_REVIEW (rejected) or any other state is not directly approvable —
      // a rejected candidate must be reactivated first (a separate audited step).
      return illegal(action, "not-reviewable", status);

    case "reject":
      if (status === S.NEEDS_REVIEW) return apply(action, status, S.SKIPPED_REVIEW, false);
      if (status === S.SKIPPED_REVIEW) return noop(action, "already-rejected", status);
      return illegal(action, "not-reviewable", status);

    case "reactivate":
      if (status === S.SKIPPED_REVIEW) return apply(action, status, S.NEEDS_REVIEW, false);
      if (status === S.NEEDS_REVIEW) return noop(action, "already-in-review", status);
      return illegal(action, "not-rejected", status);

    default:
      return illegal(action, "not-reviewable", status);
  }
}
