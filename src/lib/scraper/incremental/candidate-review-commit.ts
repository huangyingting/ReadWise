/**
 * Thin, guarded candidate-review persistence (issue #1100, Phase 3.1).
 *
 * Applies ONE pure {@link decideCandidateReview} decision onto a CrawlCandidate
 * using the repo's guarded-transition house style (reads before the tx; a single
 * interactive `$transaction` re-validates state; a guarded
 * `updateMany({ where: { id, status, articleId: null } })` whose zero-row result
 * rolls the whole write back). It writes NO new decision logic — the pure policy
 * owns legality/idempotency — and it NEVER fetches a body, writes an Article, or
 * mutates a candidate that already links one (governing invariant).
 *
 * Approval routes the candidate into the NORMAL candidate ingest pipeline by
 * enqueuing the same idempotent `article-ingest:candidate:<id>:v<version>` Job the
 * discovery loop uses, INSIDE the transaction. Because the guarded update matches
 * only a NEEDS_REVIEW row and the enqueue is an upsert on the dedupe key,
 * approving the same candidate twice creates EXACTLY ONE active Job (AC1): the
 * second call re-reads a QUEUED/INGESTING/INGESTED candidate and the pure policy
 * returns an idempotent no-op that enqueues nothing. Rejection records
 * SKIPPED_REVIEW (terminal, never rediscovered); reactivation is a separate
 * audited SKIPPED_REVIEW→NEEDS_REVIEW action.
 */
import { CrawlCandidateStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { enqueueCandidateIngestInTx } from "@/lib/jobs/enqueue";

import {
  decideCandidateReview,
  type CandidateReviewAction,
  type CandidateReviewIllegalReason,
  type CandidateReviewNoopReason,
} from "./candidate-review-policy";

/** Sanitized terminalReason category stamped when an operator rejects/reactivates. */
const REJECTED_REASON = "operator:rejected_review";
const REACTIVATED_REASON = "operator:reactivated_review";

/** Outcome of {@link applyCandidateReview} (route maps failures to HTTP status). */
export type CandidateReviewOutcome =
  | {
      ok: true;
      kind: "applied";
      action: CandidateReviewAction;
      candidateId: string;
      fromStatus: CrawlCandidateStatus;
      toStatus: CrawlCandidateStatus;
      /** True only for an approve that enqueued (or reused) the ingest Job. */
      enqueued: boolean;
    }
  | {
      ok: true;
      kind: "noop";
      action: CandidateReviewAction;
      candidateId: string;
      reason: CandidateReviewNoopReason;
      status: CrawlCandidateStatus;
    }
  | { ok: false; reason: "not-found"; action: CandidateReviewAction; candidateId: string }
  | {
      ok: false;
      reason: "illegal";
      action: CandidateReviewAction;
      candidateId: string;
      illegal: CandidateReviewIllegalReason;
      status: CrawlCandidateStatus;
    }
  | {
      ok: false;
      reason: "stale";
      action: CandidateReviewAction;
      candidateId: string;
      status: CrawlCandidateStatus;
    };

/** Rolls the whole transaction back when the guarded update matches zero rows. */
class StaleCandidateError extends Error {
  constructor() {
    super("candidate changed concurrently during review commit");
    this.name = "StaleCandidateError";
  }
}

type CandidateStateRow = { status: CrawlCandidateStatus; articleId: string | null };

async function loadState(candidateId: string): Promise<CandidateStateRow | null> {
  return prisma.crawlCandidate.findUnique({
    where: { id: candidateId },
    select: { status: true, articleId: true },
  });
}

/** Fields written for a successful transition. */
function updateDataFor(
  action: CandidateReviewAction,
  toStatus: CrawlCandidateStatus,
  now: Date,
): Prisma.CrawlCandidateUpdateManyMutationInput {
  switch (action) {
    case "approve":
      // Becomes active queued work — clear the review park metadata.
      return { status: toStatus, terminalReason: null, terminalAt: null, updatedAt: now };
    case "reject":
      return {
        status: toStatus,
        terminalReason: REJECTED_REASON,
        terminalAt: now,
        updatedAt: now,
      };
    case "reactivate":
      // Returns to the review queue — clear the terminal stamp.
      return {
        status: toStatus,
        terminalReason: REACTIVATED_REASON,
        terminalAt: null,
        updatedAt: now,
      };
    default:
      return { status: toStatus, updatedAt: now };
  }
}

/**
 * Applies an operator review action to one candidate. Reads its state, asks the
 * pure policy for the decision, and — only for an `apply` — runs the guarded
 * transaction. A guarded zero-row update (someone changed the candidate first) is
 * resolved by re-reading and re-deciding: a now-idempotent action returns `noop`,
 * anything else returns `stale` so the UI can refresh.
 */
export async function applyCandidateReview(input: {
  candidateId: string;
  action: CandidateReviewAction;
  now?: Date;
}): Promise<CandidateReviewOutcome> {
  const { candidateId, action } = input;
  const now = input.now ?? new Date();

  const state = await loadState(candidateId);
  if (!state) return { ok: false, reason: "not-found", action, candidateId };

  const decision = decideCandidateReview({
    action,
    status: state.status,
    hasArticle: state.articleId !== null,
  });

  if (decision.kind === "illegal") {
    return {
      ok: false,
      reason: "illegal",
      action,
      candidateId,
      illegal: decision.reason,
      status: decision.status,
    };
  }
  if (decision.kind === "noop") {
    return { ok: true, kind: "noop", action, candidateId, reason: decision.reason, status: decision.status };
  }

  const { fromStatus, toStatus, enqueueIngest } = decision;
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.crawlCandidate.updateMany({
        // Guard on the exact expected status AND articleId===null: a concurrent
        // transition or a newly-linked Article aborts the write (governing invariant).
        where: { id: candidateId, status: fromStatus, articleId: null },
        data: updateDataFor(action, toStatus, now),
      });
      if (updated.count === 0) throw new StaleCandidateError();

      if (enqueueIngest) {
        await enqueueCandidateIngestInTx(tx, candidateId);
      }
    });
  } catch (error) {
    if (!(error instanceof StaleCandidateError)) throw error;
    // Re-read + re-decide: a concurrent identical action is an idempotent no-op.
    const fresh = await loadState(candidateId);
    if (!fresh) return { ok: false, reason: "not-found", action, candidateId };
    const redecision = decideCandidateReview({
      action,
      status: fresh.status,
      hasArticle: fresh.articleId !== null,
    });
    if (redecision.kind === "noop") {
      return { ok: true, kind: "noop", action, candidateId, reason: redecision.reason, status: redecision.status };
    }
    return { ok: false, reason: "stale", action, candidateId, status: fresh.status };
  }

  return {
    ok: true,
    kind: "applied",
    action,
    candidateId,
    fromStatus,
    toStatus,
    enqueued: enqueueIngest,
  };
}
