/**
 * PURE canonical-conflict resolution + deletion-governance policy (issue #1104,
 * Phase 3.5).
 *
 * Owns the state-machine legality of an operator resolving a {@link
 * CanonicalConflict} and the controlled reason CATEGORIES stamped by the
 * deletion / recovery ledger writes — WITHOUT touching the database, network, or
 * clock (pure-logic house style, mirroring `candidate-review-policy.ts` /
 * `classify.ts`). The thin `canonical-conflict-commit.ts` /
 * `deleted-article-recovery.ts` modules apply the returned decision under a
 * guarded transaction; this module owns legality + idempotency only.
 *
 * GOVERNING INVARIANT (program-wide): normal incremental ingestion NEVER
 * auto-refetches, updates, recreates, or revives a known public Article. Every
 * resolution / recovery encoded here is EXPLICIT OPERATOR ACTION, so a legal
 * resolve requires the operator to name the surviving Article, and it must be one
 * of the conflict's own contested public identities.
 */
import { CanonicalConflictStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Controlled reason CATEGORIES (sanitized machine strings — never URLs/content).
// ---------------------------------------------------------------------------

/**
 * Terminal reason stamped on the producing CrawlCandidate when its Article is
 * deleted (issue #1104, AC2). The candidate SURVIVES the delete (`articleId`
 * SetNull) so a known identity is never auto-recreated; this reason plus a
 * non-null `articleDeletedAt` is the authoritative "permanent deleted outcome"
 * signal (no new enum value is required — see the module design note).
 */
export const ARTICLE_DELETED_TERMINAL_REASON = "governance:article-deleted";

/**
 * Terminal reason stamped on the surviving identity's CrawlCandidate when an
 * operator resolves a canonical conflict in its favour (issue #1104, AC1).
 */
export const CONFLICT_SURVIVOR_TERMINAL_REASON = "governance:conflict-survivor";

/**
 * Terminal reason stamped on a folded loser CrawlCandidate whose contested
 * identity was resolved onto the survivor (challenger/incumbent history is kept,
 * never erased — non-goal: never erase candidate identity).
 */
export const CONFLICT_LOSER_TERMINAL_REASON = "governance:conflict-loser";

/**
 * Machine reason recorded on the ContentReview history row written when a loser
 * Article is archived out of public feeds during conflict resolution.
 */
export const CONFLICT_LOSER_GOVERNANCE_ACTION = "conflict-resolution.archived-loser";

// ---------------------------------------------------------------------------
// Conflict-resolution decision (pure).
// ---------------------------------------------------------------------------

/** Illegal-resolution reason codes (sanitized categories — never content). */
export type ConflictResolveIllegalReason =
  /** The named survivor is not one of the conflict's contested public identities. */
  | "survivor-not-a-participant"
  /** The conflict has no contested public Article to resolve onto. */
  | "no-participants";

/** Idempotent no-op reason codes (the conflict was already decided). */
export type ConflictResolveNoopReason = "already-resolved" | "already-dismissed";

/** Inputs the pure decision reads — all metadata ids/status, no URLs/content. */
export type ConflictResolveInput = {
  status: CanonicalConflictStatus;
  /** The operator-selected surviving public Article id. */
  survivingArticleId: string;
  /** The conflict's contested public Article ids (computed reads-before-tx). */
  participantArticleIds: readonly string[];
};

/** Outcome of {@link decideConflictResolution}. */
export type ConflictResolveDecision =
  | {
      kind: "apply";
      survivingArticleId: string;
      /** Contested Article ids other than the survivor — archived out of public feeds. */
      loserArticleIds: string[];
    }
  | { kind: "noop"; reason: ConflictResolveNoopReason; status: CanonicalConflictStatus }
  | {
      kind: "illegal";
      reason: ConflictResolveIllegalReason;
      status: CanonicalConflictStatus;
    };

function illegal(
  reason: ConflictResolveIllegalReason,
  status: CanonicalConflictStatus,
): ConflictResolveDecision {
  return { kind: "illegal", reason, status };
}

/**
 * Decides whether an operator may resolve a canonical conflict onto the named
 * survivor. Deterministic and side-effect free.
 *
 * Legality:
 *   - A RESOLVED / DISMISSED conflict is an idempotent no-op (never re-opened).
 *   - The survivor MUST be one of the conflict's contested public identities
 *     (AC1: "validate the chosen survivor is one of the conflicting identities").
 *   - There must be at least one contested public Article.
 */
export function decideConflictResolution(
  input: ConflictResolveInput,
): ConflictResolveDecision {
  const { status, survivingArticleId, participantArticleIds } = input;

  if (status === CanonicalConflictStatus.RESOLVED) {
    return { kind: "noop", reason: "already-resolved", status };
  }
  if (status === CanonicalConflictStatus.DISMISSED) {
    return { kind: "noop", reason: "already-dismissed", status };
  }

  if (participantArticleIds.length === 0) {
    return illegal("no-participants", status);
  }
  if (!participantArticleIds.includes(survivingArticleId)) {
    return illegal("survivor-not-a-participant", status);
  }

  const loserArticleIds = participantArticleIds.filter((articleId) => articleId !== survivingArticleId);
  return { kind: "apply", survivingArticleId, loserArticleIds };
}
