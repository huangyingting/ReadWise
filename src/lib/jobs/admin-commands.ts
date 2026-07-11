/**
 * Admin job actions (retry / cancel / archive) — RW-017.
 *
 * Safe admin actions with per-status safety guards, using
 * {@link DomainResult} instead of a local result union.
 *
 * Lifecycle functions (retryJob, cancelJob) now include their own atomic
 * expected-status predicates, so these guards are defense-in-depth.
 */
import { JobStatus, type Job } from "@prisma/client";
import {
  TERMINAL_STATUSES,
} from "./types";
import {
  archiveJob,
  cancelJob,
  retryJob,
} from "./lifecycle";
import { getJob } from "./queries";
import { type DomainResult, notFound, conflict, validationError, ok } from "@/lib/result";

export const JOB_ACTIONS = ["retry", "cancel", "archive"] as const;
export type JobActionName = (typeof JOB_ACTIONS)[number];

const RETRYABLE_STATUSES: readonly JobStatus[] = [
  JobStatus.FAILED,
  JobStatus.DEAD_LETTER,
];

type JobActionResult = DomainResult<{
  job: Job;
  previousStatus: string;
  action: JobActionName;
}>;

function isRetryableStatus(status: JobStatus): boolean {
  return RETRYABLE_STATUSES.includes(status);
}

function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

function actionOk(
  job: Job,
  previousStatus: string,
  action: JobActionName,
): JobActionResult {
  return ok({ job, previousStatus, action });
}

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
): Promise<JobActionResult> {
  const job = await getJob(jobId);
  if (!job) {
    return notFound("Job not found");
  }
  const previousStatus = job.status;
  const isTerminal = isTerminalStatus(job.status);

  switch (action) {
    case "retry": {
      if (!isRetryableStatus(job.status)) {
        return conflict(`Cannot retry a ${job.status} job`);
      }
      const updated = await retryJob(jobId);
      if (!updated) return conflict(`Cannot retry a ${job.status} job (status changed)`);
      return actionOk(updated, previousStatus, action);
    }
    case "cancel": {
      if (isTerminal) {
        return conflict(`Cannot cancel a ${job.status} job`);
      }
      const updated = await cancelJob(jobId, { reason: "cancelled by admin" });
      if (!updated) return conflict(`Cannot cancel a ${job.status} job (status changed)`);
      return actionOk(updated, previousStatus, action);
    }
    case "archive": {
      if (!isTerminal) {
        return conflict(
          `Cannot archive a ${job.status} job (only completed or dead-letter jobs)`,
        );
      }
      const removed = await archiveJob(jobId);
      if (!removed) return notFound("Job not found");
      return actionOk(removed, previousStatus, action);
    }
    default: {
      return validationError("Unknown action");
    }
  }
}
