import { NextResponse } from "next/server";

import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { idParams, number, object, oneOf, string } from "@/lib/validation";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";
import { getSourceTrustSnapshot } from "@/lib/scraper/incremental/source-trust-query";
import {
  demoteSourceTrust,
  promoteSourceTrust,
  type SourceTrustAction,
  type SourceTrustCommitResult,
} from "@/lib/scraper/incremental/source-trust-commit";

const trustBody = object({
  action: oneOf<SourceTrustAction>(["promote", "demote"]),
  definitionVersion: number({ int: true, min: 0 }),
  reason: string({ min: 1, max: 500 }),
});

/** Client-safe status + message for each trust-commit failure. */
const FAILURE_RESPONSE: Record<string, { status: number; message: string }> = {
  "source-not-found": { status: 404, message: "Discovery source not found" },
  "version-mismatch": { status: 409, message: "Definition version changed; refresh and retry" },
  busy: { status: 409, message: "Source is currently being processed by a worker" },
  ineligible: { status: 409, message: "Source does not meet the trust-promotion bar" },
  stale: { status: 409, message: "Source changed concurrently; refresh and retry" },
};

/** Flattened, sanitized evidence for the audit record (no private content). */
function evidenceSummary(result: Extract<SourceTrustCommitResult, { ok: true }>) {
  const e = result.evidence;
  return {
    sampleSize: e.sampleSize,
    approvalRate: e.approvalRate,
    oldItemFalsePositives: e.oldItemFalsePositives,
    oldItemFalsePositiveRate: e.oldItemFalsePositiveRate,
    zeroDiscoveryStreak: e.drift.zeroDiscoveryStreak,
    consecutiveFailures: e.drift.consecutiveFailures,
    volumeAnomaly: e.drift.volumeAnomaly,
    conflictRate: e.drift.conflictRate,
  };
}

/**
 * Returns the sanitized trust snapshot for one source (#1100): identity, current
 * trust policy booleans, the evidence summary (sample size, approval rate,
 * old-item false-positive rate, drift evidence), and the REPORTED promotion
 * eligibility (never an action). Gated on `sources.manage`. No credential, URL,
 * body, or article content is exposed. 404 when the source does not exist.
 */
export const GET = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { params: idParams },
  async ({ params }) => {
    const source = await getSourceTrustSnapshot(params.id);
    if (!source) {
      return NextResponse.json({ error: "Discovery source not found" }, { status: 404 });
    }
    return NextResponse.json({ source });
  },
);

/**
 * EXPLICITLY promotes or demotes a source's auto-publish trust (#1100). Gated on
 * `sources.manage` (deny-by-default + CSRF via the wrapper). Version-scoped: the
 * body's `definitionVersion` must match the source's current version (a
 * re-versioned source is refused). A required `reason` is recorded. Promotion is
 * refused when the eligibility report is not clear (metrics never auto-promote,
 * and an old-item false positive can never be trusted). A state-CHANGING promote
 * or demote writes a sanitized audit entry: actor (from the request/session),
 * source id + version, before/after policy, reason, and the evidence summary —
 * never any private content.
 */
export const POST = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { params: idParams, body: trustBody },
  async ({ req, params, body, session, requestId }) => {
    const result =
      body.action === "promote"
        ? await promoteSourceTrust({ sourceId: params.id, definitionVersion: body.definitionVersion })
        : await demoteSourceTrust({ sourceId: params.id, definitionVersion: body.definitionVersion });

    if (!result.ok) {
      const mapped = FAILURE_RESPONSE[result.reason];
      return NextResponse.json(
        {
          error: mapped.message,
          reason: result.reason,
          ...(result.reason === "stale" ? { stale: true } : {}),
          ...(result.blockers ? { blockers: result.blockers } : {}),
        },
        { status: mapped.status },
      );
    }

    if (result.changed) {
      await recordAuditFromRequest({
        req,
        session,
        requestId,
        action: AUDIT_ACTIONS.adminSourceTrustPromotion,
        targetType: "discovery_source",
        targetId: result.sourceId,
        metadata: {
          action: result.action,
          definitionVersion: result.definitionVersion,
          reason: body.reason,
          before: result.before,
          after: result.after,
          evidence: evidenceSummary(result),
          ...(result.toMode ? { toMode: result.toMode } : {}),
        },
      });
    }

    return NextResponse.json({
      ok: true,
      action: result.action,
      changed: result.changed,
      definitionVersion: result.definitionVersion,
      before: result.before,
      after: result.after,
      ...(result.toMode ? { toMode: result.toMode } : {}),
    });
  },
);
