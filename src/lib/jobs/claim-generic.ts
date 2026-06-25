/**
 * Generic (SQLite / non-PostgreSQL) claim adapter — serialized transaction with
 * a guarded conditional update for stale-lock recovery (RW-014).
 */
import { prisma } from "@/lib/prisma";
import { Prisma, JobStatus, JobType, type Job } from "@prisma/client";
import { createLogger } from "@/lib/logger";
import { recordJobLockAge, recordJobQueueEvent } from "@/lib/metrics";
import { RUNNABLE_STATUSES, RECLAIMABLE_STATUSES } from "./types";

const log = createLogger("jobs");

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
  const runnableWhere: Prisma.JobWhereInput = {
    OR: [
      { status: { in: RUNNABLE_STATUSES }, runAfter: { lte: now } },
      { status: { in: RECLAIMABLE_STATUSES }, lockedAt: { lt: staleBefore } },
    ],
    ...(types && types.length > 0 ? { type: { in: types } } : {}),
  };

  return prisma.$transaction(async (tx) => {
    const candidate = await tx.job.findFirst({
      where: runnableWhere,
      orderBy: [{ priority: "desc" }, { runAfter: "asc" }, { createdAt: "asc" }],
    });
    if (!candidate) return null;

    // Guarded update: only succeeds if the row is still claimable, so two
    // transactions that read the same candidate cannot both win.
    const updated = await tx.job.updateMany({
      where: { id: candidate.id, ...runnableWhere },
      data: { status: JobStatus.CLAIMED, lockedBy: workerId, lockedAt: now, updatedAt: now },
    });
    if (updated.count === 0) return null;

    if (RECLAIMABLE_STATUSES.includes(candidate.status)) {
      const ageMs = candidate.lockedAt ? now.getTime() - candidate.lockedAt.getTime() : 0;
      recordJobLockAge(candidate.type, Math.max(0, ageMs));
      recordJobQueueEvent({ event: "stale_reclaimed", type: candidate.type });
      log.warn("recovered stale job lock", { jobId: candidate.id, type: candidate.type, lockAgeMs: ageMs });
    }

    return tx.job.findUnique({ where: { id: candidate.id } });
  });
}
