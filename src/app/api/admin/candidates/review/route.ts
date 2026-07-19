import { NextResponse } from "next/server";

import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { array, nonEmptyString, object, oneOf, optional, string } from "@/lib/validation";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";
import {
  CANDIDATE_REVIEW_ACTIONS,
  REASON_REQUIRED_ACTIONS,
  type CandidateReviewAction,
} from "@/lib/scraper/incremental/candidate-review-policy";
import {
  applyCandidateReview,
  type CandidateReviewOutcome,
} from "@/lib/scraper/incremental/candidate-review-commit";

/** Bounded batch: ONE action applied to up to 100 candidates. */
const MAX_BATCH = 100;

const batchBody = object({
  action: oneOf<CandidateReviewAction>(CANDIDATE_REVIEW_ACTIONS),
  ids: array(nonEmptyString(200), { max: MAX_BATCH }),
  reason: optional(string({ min: 1, max: 500 })),
});

/** One sanitized per-item result in the partial-batch response. */
function outcomeItem(outcome: CandidateReviewOutcome): Record<string, unknown> {
  if (outcome.ok) {
    return outcome.kind === "applied"
      ? {
          candidateId: outcome.candidateId,
          ok: true,
          outcome: "applied",
          fromStatus: outcome.fromStatus,
          toStatus: outcome.toStatus,
          enqueued: outcome.enqueued,
        }
      : {
          candidateId: outcome.candidateId,
          ok: true,
          outcome: "noop",
          reason: outcome.reason,
          status: outcome.status,
        };
  }
  if (outcome.reason === "illegal") {
    return {
      candidateId: outcome.candidateId,
      ok: false,
      reason: "illegal",
      detail: outcome.illegal,
      status: outcome.status,
    };
  }
  if (outcome.reason === "stale") {
    return {
      candidateId: outcome.candidateId,
      ok: false,
      reason: "stale",
      stale: true,
      status: outcome.status,
    };
  }
  return { candidateId: outcome.candidateId, ok: false, reason: "not-found" };
}

/**
 * Applies ONE review action to a bounded batch of candidates (#1100). Gated on
 * `sources.manage` (deny-by-default + CSRF via the wrapper). `reject`/`reactivate`
 * REQUIRE a reason. Each candidate is processed idempotently and INDEPENDENTLY, so
 * the response is a PARTIAL-BATCH result: a per-item outcome array (applied / noop
 * / illegal / stale / not-found) plus a summary — one candidate failing never
 * aborts the others. Each state-CHANGING item writes a sanitized audit entry.
 */
export const POST = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { body: batchBody },
  async ({ req, body, session, requestId }) => {
    if (REASON_REQUIRED_ACTIONS.includes(body.action) && !body.reason) {
      return NextResponse.json(
        { error: `A reason is required to ${body.action} candidates` },
        { status: 400 },
      );
    }
    // De-duplicate ids so the same candidate is acted on at most once per batch.
    const ids = [...new Set(body.ids)];
    if (ids.length === 0) {
      return NextResponse.json({ error: "At least one candidate id is required" }, { status: 400 });
    }

    const results: Record<string, unknown>[] = [];
    let applied = 0;
    let noop = 0;
    let failed = 0;

    for (const candidateId of ids) {
      const outcome = await applyCandidateReview({ candidateId, action: body.action });
      results.push(outcomeItem(outcome));

      if (outcome.ok && outcome.kind === "applied") {
        applied += 1;
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
            batch: true,
            ...(body.reason ? { reason: body.reason } : {}),
          },
        });
      } else if (outcome.ok) {
        noop += 1;
      } else {
        failed += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      action: body.action,
      results,
      summary: { total: ids.length, applied, noop, failed },
    });
  },
);
