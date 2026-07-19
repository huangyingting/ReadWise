/**
 * Cancels a source's UNCLAIMED (PENDING) candidate-based ARTICLE_INGEST jobs
 * during an active→shadow rollback (issue #1097, Phase 2.7).
 *
 * "Cancel unclaimed candidate jobs" = the source's `PENDING` (not-yet-claimed)
 * candidate-based ingest jobs. There is no `JobStatus.CANCELLED`; consistent
 * with the existing `cancelJob()` convention, a cancelled job is moved to the
 * terminal, non-claimable `DEAD_LETTER` with a controlled reason. The move is
 * guarded on `status = PENDING`, so a job a worker claims concurrently is NEVER
 * cancelled here — it instead fails closed at Article commit via the #1095
 * activation-generation guard. Candidates and observations are untouched.
 *
 * Runs INSIDE the caller's rollback transaction so the mode flip + generation
 * bump + job cancellation are all-or-nothing. The Job model has no FK to a
 * candidate, so pending candidate-ingest jobs are matched by their deterministic
 * dedupe-key prefix and filtered to the source's candidate ids via their
 * (candidate-identity-only) payloads. PRIVACY: only ids, counts, and a reason
 * code cross this seam — never a URL or article content.
 */
import { JobStatus, JobType, type Prisma } from "@prisma/client";

import { isCandidateIngestPayload } from "./candidate-ingest";

/** Dedupe-key prefix shared by every candidate-based ingest job (any version). */
export const CANDIDATE_INGEST_DEDUPE_PREFIX = "article-ingest:candidate:";

/** Controlled terminal reason recorded on a rollback-cancelled ingest job. */
export const ROLLBACK_CANCELLED_REASON = "rollback-cancelled";

/**
 * Moves the PENDING candidate-ingest jobs whose candidate id is in
 * `candidateIds` to `DEAD_LETTER` (reason {@link ROLLBACK_CANCELLED_REASON}).
 * Returns the number of jobs cancelled. Idempotent: an already-terminal or
 * already-claimed job is skipped by the `status = PENDING` guard.
 */
export async function cancelPendingCandidateIngestJobsInTx(
  tx: Prisma.TransactionClient,
  candidateIds: readonly string[],
  now: Date,
  reason: string = ROLLBACK_CANCELLED_REASON,
): Promise<number> {
  if (candidateIds.length === 0) return 0;
  const candidateSet = new Set(candidateIds);

  // Pending candidate-ingest jobs are transient (claimed quickly), so this scan
  // is bounded. Match by the deterministic dedupe-key prefix, then keep only
  // those whose payload candidate id belongs to the rolled-back source.
  const pending = await tx.job.findMany({
    where: {
      status: JobStatus.PENDING,
      type: JobType.ARTICLE_INGEST,
      dedupeKey: { startsWith: CANDIDATE_INGEST_DEDUPE_PREFIX },
    },
    select: { id: true, payload: true },
  });

  const ids = pending
    .filter((job) => {
      const payload = job.payload;
      return isCandidateIngestPayload(payload) && candidateSet.has(payload.candidateId);
    })
    .map((job) => job.id);
  if (ids.length === 0) return 0;

  const res = await tx.job.updateMany({
    where: { id: { in: ids }, status: JobStatus.PENDING },
    data: {
      status: JobStatus.DEAD_LETTER,
      lastError: reason,
      deadLetteredAt: now,
      lockedBy: null,
      lockedAt: null,
      updatedAt: now,
    },
  });
  return res.count;
}
