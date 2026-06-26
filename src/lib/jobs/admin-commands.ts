/**
 * Admin job actions (retry / cancel / archive) — RW-017.
 *
 * Safe admin actions with per-status safety guards, using
 * {@link DomainResult} instead of a local result union.
 */
import { JobStatus, type Job } from "@prisma/client";
import {
  TERMINAL_STATUSES,
  archiveJob,
  cancelJob,
  getJob,
  retryJob,
} from "@/lib/jobs";
import { type DomainResult, notFound, conflict, validationError, ok } from "@/lib/result";

export const JOB_ACTIONS = ["retry", "cancel", "archive"] as const;
export type JobActionName = (typeof JOB_ACTIONS)[number];

/**
 * Runs a safe admin action against a job. Guards which transitions are allowed
 * for the job's current status so an operator can't, e.g., archive a running
 * job out from under the worker:
 *
 *   - retry:   only FAILED / DEAD_LETTER jobs (re-queue).
 *   - cancel:  only non-terminal jobs (PENDING/CLAIMED/RUNNING/FAILED).
 *   - archive: only terminal jobs (COMPLETED / DEAD_LETTER) — hard delete.
 *
 * Returns a {@link DomainResult} the route layer turns into a status code + audit.
 */
export async function runJobAction(
  jobId: string,
  action: JobActionName,
): Promise<DomainResult<{ job: Job; previousStatus: string; action: JobActionName }>> {
  const job = await getJob(jobId);
  if (!job) {
    return notFound("Job not found");
  }
  const previousStatus = job.status;
  const isTerminal = TERMINAL_STATUSES.includes(job.status);

  switch (action) {
    case "retry": {
      if (job.status !== JobStatus.FAILED && job.status !== JobStatus.DEAD_LETTER) {
        return conflict(`Cannot retry a ${job.status} job`);
      }
      const updated = await retryJob(jobId);
      if (!updated) return notFound("Job not found");
      return ok({ job: updated, previousStatus, action });
    }
    case "cancel": {
      if (isTerminal) {
        return conflict(`Cannot cancel a ${job.status} job`);
      }
      const updated = await cancelJob(jobId, { reason: "cancelled by admin" });
      if (!updated) return notFound("Job not found");
      return ok({ job: updated, previousStatus, action });
    }
    case "archive": {
      if (!isTerminal) {
        return conflict(
          `Cannot archive a ${job.status} job (only completed or dead-letter jobs)`,
        );
      }
      const removed = await archiveJob(jobId);
      if (!removed) return notFound("Job not found");
      return ok({ job: removed, previousStatus, action });
    }
    default: {
      return validationError("Unknown action");
    }
  }
}
