/**
 * Generic (SQLite / non-PostgreSQL) claim adapter — serialized transaction with
 * a guarded conditional update for stale-lock recovery (RW-014).
 */
import { prisma } from "@/lib/prisma";
import { Prisma, JobStatus, JobType, type Job } from "@prisma/client";
import { createLogger } from "@/lib/observability/logger";
import { recordJobLockAge, recordJobQueueEvent } from "@/lib/metrics";
import { RUNNABLE_STATUSES, RECLAIMABLE_STATUSES } from "./types";

const log = createLogger("jobs");

type ClaimTransaction = Pick<Prisma.TransactionClient, "job">;

function buildRunnableWhere(
  now: Date,
  staleBefore: Date,
  types?: JobType[],
): Prisma.JobWhereInput {
  return {
    OR: [
      { status: { in: RUNNABLE_STATUSES }, runAfter: { lte: now } },
      { status: { in: RECLAIMABLE_STATUSES }, lockedAt: { lt: staleBefore } },
    ],
    ...(types && types.length > 0 ? { type: { in: types } } : {}),
  };
}

async function claimCandidateJob(
  tx: ClaimTransaction,
  candidate: Job,
  runnableWhere: Prisma.JobWhereInput,
  workerId: string,
  now: Date,
): Promise<boolean> {
  const updated = await tx.job.updateMany({
    where: { id: candidate.id, ...runnableWhere },
    data: { status: JobStatus.CLAIMED, lockedBy: workerId, lockedAt: now, updatedAt: now },
  });
  return updated.count > 0;
}

function recordStaleLockRecovery(candidate: Job, now: Date): void {
  if (!RECLAIMABLE_STATUSES.includes(candidate.status)) return;

  const ageMs = candidate.lockedAt ? now.getTime() - candidate.lockedAt.getTime() : 0;
  recordJobLockAge(candidate.type, Math.max(0, ageMs));
  recordJobQueueEvent({ event: "stale_reclaimed", type: candidate.type });
  log.warn("recovered stale job lock", {
    jobId: candidate.id,
    type: candidate.type,
    lockAgeMs: ageMs,
  });
}

/**
 * Claims one runnable job using a serialized transaction with a guarded
 * conditional update. The guarded `updateMany` ensures two transactions that
 * read the same candidate cannot both win the claim. Stale locks are recovered
 * identically to the PostgreSQL adapter.
 */
export async function claimNextJobGeneric(
  workerId: string,
  now: Date,
  staleBefore: Date,
  types?: JobType[],
): Promise<Job | null> {
  const runnableWhere = buildRunnableWhere(now, staleBefore, types);

  return prisma.$transaction(async (tx) => {
    const candidate = await tx.job.findFirst({
      where: runnableWhere,
      orderBy: [{ priority: "desc" }, { runAfter: "asc" }, { createdAt: "asc" }],
    });
    if (!candidate) return null;

    // Guarded update: only succeeds if the row is still claimable, so two
    // transactions that read the same candidate cannot both win.
    const claimed = await claimCandidateJob(tx, candidate, runnableWhere, workerId, now);
    if (!claimed) return null;

    recordStaleLockRecovery(candidate, now);

    return tx.job.findUnique({ where: { id: candidate.id } });
  });
}
