/**
 * Public claim API — dispatches to the PostgreSQL or generic adapter based on
 * the active database URL (RW-014).
 */
import { JobType, type Job } from "@prisma/client";
import { recordJobQueueEvent } from "@/lib/metrics";
import { DEFAULT_LOCK_TTL_MS } from "./types";
import { claimNextJobPostgres } from "./claim-postgres";
import { claimNextJobGeneric } from "./claim-generic";
import { isPostgresDatabase } from "@/lib/db-utils";

export type ClaimOptions = {
  /** Restrict to specific job types. */
  types?: JobType[];
  /** Lock lease length (ms). Older locks are treated as stale. */
  lockTtlMs?: number;
  /** Override "now" (testing). */
  now?: Date;
};

function claimWindow(opts: ClaimOptions): { now: Date; staleBefore: Date } {
  const now = opts.now ?? new Date();
  const lockTtlMs = opts.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  return { now, staleBefore: new Date(now.getTime() - lockTtlMs) };
}

async function claimWithActiveAdapter(
  workerId: string,
  now: Date,
  staleBefore: Date,
  types?: JobType[],
): Promise<Job | null> {
  return isPostgresDatabase()
    ? claimNextJobPostgres(workerId, now, staleBefore, types)
    : claimNextJobGeneric(workerId, now, staleBefore, types);
}

function recordClaim(job: Job): Job {
  recordJobQueueEvent({ event: "claimed", type: job.type });
  return job;
}

/**
 * Atomically claims one runnable job for `workerId`, marking it CLAIMED with a
 * fresh lock. Returns null when nothing is runnable. Safe under concurrency:
 * PostgreSQL uses `FOR UPDATE SKIP LOCKED`; other providers use a serialized
 * transaction with a guarded conditional update.
 */
export async function claimNextJob(workerId: string, opts: ClaimOptions = {}): Promise<Job | null> {
  const { now, staleBefore } = claimWindow(opts);
  const job = await claimWithActiveAdapter(workerId, now, staleBefore, opts.types);

  if (!job) return null;
  return recordClaim(job);
}
