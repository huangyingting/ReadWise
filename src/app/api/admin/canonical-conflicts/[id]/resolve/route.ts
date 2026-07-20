import { NextResponse } from "next/server";

import { createCapabilityHandler } from "@/lib/api-handler";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
import { CAPABILITIES } from "@/lib/rbac";
import { boolean, idParams, object, oneOf, optional, string } from "@/lib/validation";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";
import {
  resolveCanonicalConflict,
  type ConflictResolveOutcome,
} from "@/lib/scraper/incremental/canonical-conflict-commit";

const resolveBody = object({
  /**
   * TYPE A (baseline) selector: the operator-selected surviving public Article id
   * (must be a participant). Exactly one of `survivingArticleId` / `canonical` is
   * required; it must match the conflict's kind or the resolve is rejected 409.
   */
  survivingArticleId: optional(string({ min: 1, max: 200 })),
  /**
   * TYPE B (runtime) selector (#1135): the explicit incumbent-vs-challenger
   * canonical decision. `incumbent` keeps the incumbent (folds the challenger);
   * `challenger` promotes the challenger (transfers the canonical claim, folds the
   * incumbent's aliases, archives + retains the incumbent's produced Article).
   */
  canonical: optional(oneOf(["incumbent", "challenger"] as const)),
  /** Required audit reason (destructive/governance action). */
  reason: string({ min: 1, max: 500 }),
  /** Explicit confirmation of the destructive resolution. */
  confirm: boolean(),
  /**
   * OPT-IN (#1134, Type A only): also migrate the losers' reader/learning data onto
   * the survivor. Absent/false preserves #1104's retain-on-loser behavior exactly.
   */
  migrateReaderData: optional(boolean()),
});

/** Client-safe message for each illegal-resolution reason. */
const ILLEGAL_MESSAGE: Record<string, string> = {
  "survivor-not-a-participant":
    "The selected article is not one of this conflict's contested identities",
  "no-participants": "This conflict has no contested public article to resolve onto",
  "wrong-conflict-type":
    "This conflict's type does not match the submitted decision; refresh and retry",
  "incumbent-candidate-missing": "This conflict's incumbent candidate no longer exists",
  "challenger-candidate-missing": "This conflict's challenger candidate no longer exists",
};

/** Illegal reasons that map to a 400 (a bad selection); the rest are 409s. */
const ILLEGAL_400: ReadonlySet<string> = new Set(["survivor-not-a-participant"]);

/**
 * Maps a resolution outcome to HTTP. `applied` / `applied-type-b` (state changed)
 * and `noop` (idempotent — already resolved/dismissed) are 200s; `not-found` is
 * 404; `survivor-not-a-participant` is a 400 (bad selection); `no-participants`,
 * `wrong-conflict-type`, the missing-candidate reasons, and `stale` are 409s.
 * `stale` carries `stale: true` so the UI can refresh.
 */
function resolveOutcomeResponse(outcome: ConflictResolveOutcome): NextResponse {
  if (outcome.ok) {
    if (outcome.kind === "applied") {
      return NextResponse.json({
        ok: true,
        outcome: "applied",
        conflictId: outcome.conflictId,
        survivingArticleId: outcome.survivingArticleId,
        loserArticleIds: outcome.loserArticleIds,
        survivorCandidateId: outcome.survivorCandidateId,
        ...(outcome.migration ? { migration: outcome.migration } : {}),
      });
    }
    if (outcome.kind === "applied-type-b") {
      return NextResponse.json({
        ok: true,
        outcome: "applied-type-b",
        conflictId: outcome.conflictId,
        canonical: outcome.canonical,
        winnerCandidateId: outcome.winnerCandidateId,
        loserCandidateId: outcome.loserCandidateId,
        archivedArticleId: outcome.archivedArticleId,
      });
    }
    return NextResponse.json({
      ok: true,
      outcome: "noop",
      conflictId: outcome.conflictId,
      reason: outcome.reason,
      status: outcome.status,
    });
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
  const status = ILLEGAL_400.has(outcome.illegal) ? 400 : 409;
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
 * Resolves ONE canonical conflict (#1104 Type A, #1135 Type B). Gated on
 * `sources.manage`; the wrapper enforces deny-by-default (401/403) and CSRF. A
 * `reason` AND explicit `confirm: true` are REQUIRED, plus EXACTLY ONE decision
 * selector: `survivingArticleId` for a baseline (Type A) conflict, or `canonical`
 * ("incumbent" | "challenger") for a runtime (Type B) conflict. The resolver
 * detects the conflict's kind and rejects a mismatched selector (409). Resolution
 * is atomic + concurrency-safe (guarded transaction + convergence): concurrent
 * resolvers yield an idempotent `noop`, and exactly one canonical owner remains.
 * Only a state-CHANGING outcome writes a sanitized audit entry (ids, counts,
 * enums, reason category — never a URL/content/secret).
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

    // Exactly one decision selector — never both, never neither.
    const hasSurvivor = body.survivingArticleId !== undefined;
    const hasCanonical = body.canonical !== undefined;
    if (hasSurvivor === hasCanonical) {
      return NextResponse.json(
        {
          error:
            "Provide exactly one of survivingArticleId (Type A) or canonical (Type B) to resolve",
        },
        { status: 400 },
      );
    }

    const outcome = await resolveCanonicalConflict(
      {
        conflictId: params.id,
        resolvedBy: session.user.id,
        // Exactly one selector is present (guarded above): forward only that shape
        // so a Type-A call stays byte-identical (no stray `canonical` key).
        ...(hasSurvivor
          ? {
              survivingArticleId: body.survivingArticleId,
              migrateReaderData: body.migrateReaderData ?? false,
            }
          : { canonical: body.canonical }),
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

    if (outcome.ok && outcome.kind === "applied-type-b") {
      await recordAuditFromRequest({
        req,
        session,
        requestId,
        action: AUDIT_ACTIONS.adminCanonicalConflictResolve,
        targetType: "canonical_conflict",
        targetId: outcome.conflictId,
        metadata: {
          conflictType: "type-b",
          canonical: outcome.canonical,
          winnerCandidateId: outcome.winnerCandidateId,
          loserCandidateId: outcome.loserCandidateId,
          incumbentArticleArchived: outcome.archivedArticleId !== null,
          reason: body.reason,
        },
      });
    }

    return resolveOutcomeResponse(outcome);
  },
);
