import { NextResponse } from "next/server";

import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { boolean, idParams, object, string } from "@/lib/validation";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";
import {
  recoverDeletedCandidate,
  type RecoverDeletedCandidateOutcome,
} from "@/lib/scraper/incremental/deleted-article-recovery";

const recoverBody = object({
  /** Required audit reason (explicit re-admission of a deleted identity). */
  reason: string({ min: 1, max: 500 }),
  /** Explicit confirmation of the recovery. */
  confirm: boolean(),
});

/**
 * Maps a recovery outcome to HTTP. `recovered` is 200; `not-found` is 404;
 * `ineligible` (the candidate is not a deleted identity — still linked or never
 * deleted) and `conflict` (a concurrent recovery won) are 409s. `conflict`
 * carries `stale: true` so the UI can refresh.
 */
function recoverOutcomeResponse(outcome: RecoverDeletedCandidateOutcome): NextResponse {
  if (outcome.ok) {
    return NextResponse.json({
      ok: true,
      outcome: "recovered",
      candidateId: outcome.candidateId,
      jobId: outcome.jobId,
      dedupeKey: outcome.dedupeKey,
      processingVersion: outcome.processingVersion,
    });
  }
  if (outcome.reason === "not-found") {
    return NextResponse.json({ error: "Deleted candidate not found" }, { status: 404 });
  }
  if (outcome.reason === "ineligible") {
    return NextResponse.json(
      {
        error: "Candidate is not a deleted identity and cannot be recovered",
        reason: "ineligible",
        status: outcome.status,
      },
      { status: 409 },
    );
  }
  return NextResponse.json(
    {
      error: "Candidate changed concurrently; refresh and retry",
      reason: "conflict",
      stale: true,
    },
    { status: 409 },
  );
}

/**
 * Explicitly RE-ADMITS one deleted identity (by CrawlCandidate id) for
 * re-ingestion (#1104, AC2). Gated on `sources.manage`; the wrapper enforces
 * deny-by-default (401/403) and CSRF. A `reason` AND explicit `confirm: true` are
 * REQUIRED. This is NOT a content restore: it clears the DELETED terminal, bumps
 * the extractor/processing version for a FRESH ingest dedupe key, and enqueues one
 * ARTICLE_INGEST Job (idempotent + concurrency-safe — a second concurrent recovery
 * fails safely with 409). Only a successful recovery writes a sanitized audit
 * entry (ids, version, reason category — never a URL/content/secret).
 */
export const POST = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { params: idParams, body: recoverBody },
  async ({ req, params, body, session, requestId }) => {
    if (!body.confirm) {
      return NextResponse.json(
        { error: "Confirmation is required to recover a deleted article identity" },
        { status: 400 },
      );
    }

    const outcome = await recoverDeletedCandidate(params.id);

    if (outcome.ok) {
      await recordAuditFromRequest({
        req,
        session,
        requestId,
        action: AUDIT_ACTIONS.adminArticleRecover,
        targetType: "crawl_candidate",
        targetId: outcome.candidateId,
        metadata: {
          jobId: outcome.jobId,
          processingVersion: outcome.processingVersion,
          reason: body.reason,
        },
      });
    }

    return recoverOutcomeResponse(outcome);
  },
);
