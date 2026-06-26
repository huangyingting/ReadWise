/**
 * Job queue retention — prune terminal rows (#712-C).
 *
 * Terminal job rows (`COMPLETED`, `DEAD_LETTER`) are not useful indefinitely
 * and can grow the `Job` table significantly on high-throughput deployments.
 * {@link pruneTerminalJobs} deletes rows in those states that were last updated
 * before a configurable cutoff.
 *
 * The helper is opt-in / scheduled — it does NOT run automatically and does NOT
 * affect normal job-processing paths.
 *
 * Retention is controlled by env var `JOB_TERMINAL_RETENTION_DAYS` (default 90
 * days). Override `statuses` to prune a subset of terminal states only.
 */
import { prisma } from "@/lib/prisma";
import { JobStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { positiveIntEnv } from "@/lib/runtime-config/env";

export const JOB_TERMINAL_STATUSES: JobStatus[] = [JobStatus.COMPLETED, JobStatus.DEAD_LETTER];

export type PruneJobsClient = Pick<Prisma.TransactionClient, "job">;

/**
 * Retention window (in days) for terminal job rows. Defaults to 90 days.
 * Set via `JOB_TERMINAL_RETENTION_DAYS`.
 */
export function jobTerminalRetentionDays(): number {
  return positiveIntEnv("JOB_TERMINAL_RETENTION_DAYS", 90);
}

/**
 * Deletes job rows in terminal states that have not been updated since the
 * cutoff (#712-C). `olderThanDays` defaults to {@link jobTerminalRetentionDays}
 * (env: `JOB_TERMINAL_RETENTION_DAYS`, default 90). `statuses` defaults to
 * all terminal states (`COMPLETED` and `DEAD_LETTER`). Returns the number of
 * rows removed. Intended to be run from a scheduled job or CLI maintenance
 * script.
 */
export async function pruneTerminalJobs(
  olderThanDays: number = jobTerminalRetentionDays(),
  statuses: JobStatus[] = JOB_TERMINAL_STATUSES,
  client: PruneJobsClient = prisma,
  now: Date = new Date(),
): Promise<number> {
  const days =
    Number.isFinite(olderThanDays) && olderThanDays > 0
      ? Math.floor(olderThanDays)
      : jobTerminalRetentionDays();
  if (statuses.length === 0) return 0;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const result = await client.job.deleteMany({
    where: {
      status: { in: statuses },
      updatedAt: { lt: cutoff },
    },
  });
  return result.count;
}
