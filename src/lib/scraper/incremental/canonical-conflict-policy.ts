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

/**
 * Terminal reason stamped on a folded candidate during a first-class runtime
 * (Type B) conflict resolution (issue #1135) — the challenger when the incumbent
 * is kept, or the incumbent when the challenger is promoted. History is folded as
 * a DUPLICATE alias onto the winner, never erased.
 */
export const TYPE_B_CONFLICT_LOSER_TERMINAL_REASON = "governance:type-b-conflict-loser";

/**
 * Machine reason recorded on the ContentReview row when the incumbent's produced
 * Article is archived because the challenger was promoted canonical (issue #1135).
 */
export const TYPE_B_INCUMBENT_ARCHIVED_ACTION = "conflict-resolution.type-b-incumbent-archived";

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

// ---------------------------------------------------------------------------
// First-class runtime (Type B) conflict resolution decision (pure) — issue #1135.
// ---------------------------------------------------------------------------

/**
 * A runtime (Type B) conflict is created during live ingest when a genuinely-new
 * challenger candidate resolves to an identity already owned by an incumbent
 * candidate (`incumbentCandidateId` is SET). This is DISTINCT from a baseline
 * (Type A) conflict — contested EXISTING public Article ids, `incumbentCandidateId
 * = null` — resolved by {@link decideConflictResolution}.
 */
export type ConflictKind = "type-a" | "type-b";

/** Detects the conflict KIND from its incumbent-candidate linkage (audit trail). */
export function classifyConflictKind(incumbentCandidateId: string | null): ConflictKind {
  return incumbentCandidateId == null ? "type-a" : "type-b";
}

/**
 * The explicit operator decision for a runtime (Type B) conflict — which of the
 * two contending CANDIDATES is canonical (net-new value beyond the candidate-
 * review approve/reject queue, which can only park/reject the challenger):
 *   - `incumbent` — the incumbent stays canonical; the challenger is folded as a
 *     DUPLICATE (formalizes today's reject).
 *   - `challenger` — the challenger is PROMOTED: the canonical claim transfers
 *     from the incumbent to the challenger, the incumbent's aliases fold onto it,
 *     and the incumbent's produced Article (if any) is archived + RETAINED.
 */
export type TypeBCanonicalChoice = "incumbent" | "challenger";

/** Illegal Type-B resolution reason codes (sanitized categories — never content). */
export type ConflictResolveTypeBIllegalReason =
  /** The conflict's shape does not match the submitted decision (Type-A vs Type-B). */
  | "wrong-conflict-type"
  /** The conflict's `incumbentCandidateId` references a candidate that no longer exists. */
  | "incumbent-candidate-missing"
  /** Promoting the challenger requires a parked challenger candidate that no longer exists. */
  | "challenger-candidate-missing";

/** Inputs the pure Type-B decision reads — all metadata ids/status, no URLs/content. */
export type ConflictResolveTypeBInput = {
  status: CanonicalConflictStatus;
  /** The operator's explicit canonical decision. */
  canonical: TypeBCanonicalChoice;
  /** The conflict's incumbent linkage — `null` means it is NOT a Type-B conflict. */
  incumbentCandidateId: string | null;
  /** Whether the incumbent candidate row still exists (computed reads-before-tx). */
  incumbentExists: boolean;
  /** The parked challenger candidate id matching `challengerKey`, or null if gone. */
  challengerCandidateId: string | null;
};

/** Outcome of {@link decideTypeBResolution}. */
export type ConflictResolveTypeBDecision =
  | { kind: "apply"; canonical: TypeBCanonicalChoice }
  | { kind: "noop"; reason: ConflictResolveNoopReason; status: CanonicalConflictStatus }
  | {
      kind: "illegal";
      reason: ConflictResolveTypeBIllegalReason;
      status: CanonicalConflictStatus;
    };

/**
 * Decides whether an operator may resolve a runtime (Type B) conflict with an
 * explicit incumbent-vs-challenger decision. Deterministic and side-effect free.
 *
 * Legality:
 *   - A RESOLVED / DISMISSED conflict is an idempotent no-op (never re-opened).
 *   - A conflict with no `incumbentCandidateId` is a Type-A conflict — the Type-B
 *     decision shape does not apply (`wrong-conflict-type`).
 *   - The incumbent candidate must still exist (it owns the contested canonical
 *     slot / Article); a vanished incumbent cannot be resolved automatically.
 *   - Promoting the challenger requires the parked challenger candidate to still
 *     exist (the canonical claim is transferred ONTO it). Keeping the incumbent
 *     tolerates a vanished challenger (the fold is then a safe no-op).
 */
export function decideTypeBResolution(
  input: ConflictResolveTypeBInput,
): ConflictResolveTypeBDecision {
  const { status, canonical, incumbentCandidateId, incumbentExists, challengerCandidateId } = input;

  if (status === CanonicalConflictStatus.RESOLVED) {
    return { kind: "noop", reason: "already-resolved", status };
  }
  if (status === CanonicalConflictStatus.DISMISSED) {
    return { kind: "noop", reason: "already-dismissed", status };
  }

  if (incumbentCandidateId == null) {
    return { kind: "illegal", reason: "wrong-conflict-type", status };
  }
  if (!incumbentExists) {
    return { kind: "illegal", reason: "incumbent-candidate-missing", status };
  }
  if (canonical === "challenger" && challengerCandidateId == null) {
    return { kind: "illegal", reason: "challenger-candidate-missing", status };
  }

  return { kind: "apply", canonical };
}
