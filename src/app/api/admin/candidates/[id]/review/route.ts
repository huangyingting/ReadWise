import { NextResponse } from "next/server";

import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { object, oneOf, optional, string } from "@/lib/validation";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";
import { idParams } from "@/lib/validation";
import {
  CANDIDATE_REVIEW_ACTIONS,
  REASON_REQUIRED_ACTIONS,
  type CandidateReviewAction,
} from "@/lib/scraper/incremental/candidate-review-policy";
import {
  applyCandidateReview,
  type CandidateReviewOutcome,
} from "@/lib/scraper/incremental/candidate-review-commit";

const reviewBody = object({
  action: oneOf<CandidateReviewAction>(CANDIDATE_REVIEW_ACTIONS),
  reason: optional(string({ min: 1, max: 500 })),
});

/** Client-safe message for each illegal-transition reason. */
const ILLEGAL_MESSAGE: Record<string, string> = {
  "has-article": "Candidate is linked to a public article and cannot be reviewed",
  "not-reviewable": "Candidate is not in a reviewable state for this action",
  "not-rejected": "Candidate is not rejected; only a rejected candidate can be reactivated",
};

/**
 * Turns a review outcome into the HTTP response. `applied` (state changed) and
 * `noop` (idempotent) are 200s; `not-found` is 404; `illegal` and `stale` are
 * 409s. `stale` carries `stale: true` so the UI can show the stale-candidate
 * state and refresh.
 */
export function reviewOutcomeResponse(outcome: CandidateReviewOutcome): NextResponse {
  if (outcome.ok) {
    return NextResponse.json(
      outcome.kind === "applied"
        ? {
            ok: true,
            outcome: "applied",
            action: outcome.action,
            candidateId: outcome.candidateId,
            fromStatus: outcome.fromStatus,
            toStatus: outcome.toStatus,
            enqueued: outcome.enqueued,
          }
        : {
            ok: true,
            outcome: "noop",
            action: outcome.action,
            candidateId: outcome.candidateId,
            reason: outcome.reason,
            status: outcome.status,
          },
    );
  }
  if (outcome.reason === "not-found") {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }
  if (outcome.reason === "stale") {
    return NextResponse.json(
      { error: "Candidate changed concurrently; refresh and retry", reason: "stale", stale: true, status: outcome.status },
      { status: 409 },
    );
  }
  return NextResponse.json(
    {
      error: ILLEGAL_MESSAGE[outcome.illegal] ?? "Review action not allowed",
      reason: "illegal",
      detail: outcome.illegal,
      status: outcome.status,
    },
    { status: 409 },
  );
}

/**
 * Applies ONE operator review action (approve | reject | reactivate) to a
 * candidate (#1100). Gated on `sources.manage`; the wrapper enforces
 * deny-by-default (401/403) and CSRF. `reject` and `reactivate` REQUIRE an audit
 * reason (policy-sensitive). Approval routes the candidate through the NORMAL
 * candidate ingest pipeline (idempotent — approving twice creates ONE Job);
 * rejection records SKIPPED_REVIEW (never rediscovered). Only a state-CHANGING
 * outcome writes a sanitized audit entry (ids, from/to status, reason category —
 * never a URL/content/secret).
 */
export const POST = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { params: idParams, body: reviewBody },
  async ({ req, params, body, session, requestId }) => {
    if (REASON_REQUIRED_ACTIONS.includes(body.action) && !body.reason) {
      return NextResponse.json(
        { error: `A reason is required to ${body.action} a candidate` },
        { status: 400 },
      );
    }

    const outcome = await applyCandidateReview({ candidateId: params.id, action: body.action });

    if (outcome.ok && outcome.kind === "applied") {
      await recordAuditFromRequest({
        req,
        session,
        requestId,
        action:
          outcome.action === "reactivate"
            ? AUDIT_ACTIONS.adminCandidateReactivate
            : AUDIT_ACTIONS.adminCandidateReview,
        targetType: "crawl_candidate",
        targetId: outcome.candidateId,
        metadata: {
          action: outcome.action,
          fromStatus: outcome.fromStatus,
          toStatus: outcome.toStatus,
          enqueued: outcome.enqueued,
          ...(body.reason ? { reason: body.reason } : {}),
        },
      });
    }

    return reviewOutcomeResponse(outcome);
  },
);
