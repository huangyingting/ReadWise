import { NextResponse } from "next/server";

import { createCapabilityHandler } from "@/lib/api-handler";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
import { CAPABILITIES } from "@/lib/rbac";
import { boolean, idParams, object, optional, string } from "@/lib/validation";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";
import {
  resolveCanonicalConflict,
  type ConflictResolveOutcome,
} from "@/lib/scraper/incremental/canonical-conflict-commit";

const resolveBody = object({
  /** The operator-selected surviving public Article id (must be a participant). */
  survivingArticleId: string({ min: 1, max: 200 }),
  /** Required audit reason (destructive/governance action). */
  reason: string({ min: 1, max: 500 }),
  /** Explicit confirmation of the destructive resolution. */
  confirm: boolean(),
  /**
   * OPT-IN (#1134): also migrate the losers' reader/learning data onto the
   * survivor. Absent/false preserves #1104's retain-on-loser behavior exactly.
   */
  migrateReaderData: optional(boolean()),
});

/** Client-safe message for each illegal-resolution reason. */
const ILLEGAL_MESSAGE: Record<string, string> = {
  "survivor-not-a-participant":
    "The selected article is not one of this conflict's contested identities",
  "no-participants": "This conflict has no contested public article to resolve onto",
};

/**
 * Maps a resolution outcome to HTTP. `applied` (state changed) and `noop`
 * (idempotent — already resolved/dismissed) are 200s; `not-found` is 404;
 * `survivor-not-a-participant` is a 400 (bad selection); `no-participants` and
 * `stale` are 409s. `stale` carries `stale: true` so the UI can refresh.
 */
function resolveOutcomeResponse(outcome: ConflictResolveOutcome): NextResponse {
  if (outcome.ok) {
    return NextResponse.json(
      outcome.kind === "applied"
        ? {
            ok: true,
            outcome: "applied",
            conflictId: outcome.conflictId,
            survivingArticleId: outcome.survivingArticleId,
            loserArticleIds: outcome.loserArticleIds,
            survivorCandidateId: outcome.survivorCandidateId,
            ...(outcome.migration ? { migration: outcome.migration } : {}),
          }
        : {
            ok: true,
            outcome: "noop",
            conflictId: outcome.conflictId,
            reason: outcome.reason,
            status: outcome.status,
          },
    );
  }
  if (outcome.reason === "not-found") {
    return NextResponse.json({ error: "Canonical conflict not found" }, { status: 404 });
  }
  if (outcome.reason === "stale") {
    return NextResponse.json(
      {
        error: "Conflict changed concurrently; refresh and retry",
        reason: "stale",
        stale: true,
        status: outcome.status,
      },
      { status: 409 },
    );
  }
  // illegal
  const status = outcome.illegal === "survivor-not-a-participant" ? 400 : 409;
  return NextResponse.json(
    {
      error: ILLEGAL_MESSAGE[outcome.illegal] ?? "Resolution not allowed",
      reason: "illegal",
      detail: outcome.illegal,
      status: outcome.status,
    },
    { status },
  );
}

/**
 * Resolves ONE canonical conflict onto the operator's chosen surviving public
 * Article (#1104, AC1/AC4). Gated on `sources.manage`; the wrapper enforces
 * deny-by-default (401/403) and CSRF. A `reason` AND explicit `confirm: true` are
 * REQUIRED (destructive/governance action: losers are archived out of public
 * feeds, their reader data retained). The resolution is atomic + concurrency-safe
 * (guarded transaction + convergence): concurrent resolvers yield an idempotent
 * `noop`, and exactly one public identity owner remains. Only a state-CHANGING
 * `applied` outcome writes a sanitized audit entry (ids, counts, reason category —
 * never a URL/content/secret).
 */
export const POST = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { params: idParams, body: resolveBody },
  async ({ req, params, body, session, requestId }) => {
    if (!body.confirm) {
      return NextResponse.json(
        { error: "Confirmation is required to resolve a canonical conflict" },
        { status: 400 },
      );
    }

    const outcome = await resolveCanonicalConflict(
      {
        conflictId: params.id,
        survivingArticleId: body.survivingArticleId,
        resolvedBy: session.user.id,
        migrateReaderData: body.migrateReaderData ?? false,
      },
      { deriveReaderText: articleHtmlToReaderText },
    );

    if (outcome.ok && outcome.kind === "applied") {
      await recordAuditFromRequest({
        req,
        session,
        requestId,
        action: AUDIT_ACTIONS.adminCanonicalConflictResolve,
        targetType: "canonical_conflict",
        targetId: outcome.conflictId,
        metadata: {
          survivingArticleId: outcome.survivingArticleId,
          survivorCandidateId: outcome.survivorCandidateId,
          loserArticleCount: outcome.loserArticleIds.length,
          reason: body.reason,
          migrateReaderData: body.migrateReaderData ?? false,
          ...(outcome.migration ? { migration: outcome.migration } : {}),
        },
      });
    }

    return resolveOutcomeResponse(outcome);
  },
);
