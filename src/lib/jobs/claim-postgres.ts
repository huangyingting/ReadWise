/**
 * PostgreSQL claim adapter — uses `FOR UPDATE SKIP LOCKED` for safe concurrent
 * claiming across multiple workers (RW-014).
 */
import { prisma } from "@/lib/prisma";
import { Prisma, JobType, type Job } from "@prisma/client";
import { createLogger } from "@/lib/observability/logger";
import { recordJobLockAge, recordJobQueueEvent } from "@/lib/metrics";

const log = createLogger("jobs");

/**
 * Claims one runnable job on PostgreSQL using `FOR UPDATE SKIP LOCKED`. The
 * atomic UPDATE … FROM … RETURNING pattern ensures two concurrent workers can
 * never claim the same row. Stale locks (CLAIMED/RUNNING with an expired
 * `lockedAt`) are also reclaimable so a crashed worker never strands a job.
 */
export async function claimNextJobPostgres(
  workerId: string,
  now: Date,
  staleBefore: Date,
  types?: JobType[],
): Promise<Job | null> {
  // Enum labels are inlined as string literals (constants, not user input) so
  // PostgreSQL resolves them to the native enum type; dynamic values are bound.
  const typeFilter =
    types && types.length > 0
      ? Prisma.sql`AND "type" IN (${Prisma.join(types.map((t) => Prisma.sql`${t}::"JobType"`))})`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{ id: string; wasStale: boolean; lockedAt: Date | null }>>(Prisma.sql`
    UPDATE "Job" AS j SET
      "status" = 'CLAIMED'::"JobStatus",
      "lockedBy" = ${workerId},
      "lockedAt" = ${now},
      "updatedAt" = ${now}
    FROM (
      SELECT "id", "status", "lockedAt"
      FROM "Job"
      WHERE (
        ("status" IN ('PENDING'::"JobStatus", 'FAILED'::"JobStatus") AND "runAfter" <= ${now})
        OR ("status" IN ('CLAIMED'::"JobStatus", 'RUNNING'::"JobStatus") AND "lockedAt" < ${staleBefore})
      )
      ${typeFilter}
      ORDER BY "priority" DESC, "runAfter" ASC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    ) AS picked
    WHERE j."id" = picked."id"
    RETURNING j."id" AS "id",
      (picked."status" IN ('CLAIMED'::"JobStatus", 'RUNNING'::"JobStatus")) AS "wasStale",
      picked."lockedAt" AS "lockedAt"
  `);

  if (rows.length === 0) return null;
  const { id, wasStale, lockedAt } = rows[0];
  const job = await prisma.job.findUnique({ where: { id } });
  if (job && wasStale) {
    const ageMs = lockedAt ? now.getTime() - new Date(lockedAt).getTime() : 0;
    recordJobLockAge(job.type, Math.max(0, ageMs));
    recordJobQueueEvent({ event: "stale_reclaimed", type: job.type });
    log.warn("recovered stale job lock", { jobId: id, type: job.type, lockAgeMs: ageMs });
  }
  return job;
}
