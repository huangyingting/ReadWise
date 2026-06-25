import type { ProcessOptions, processArticle } from "@/lib/processor";
import type { claimNextJob, completeJob, failJob, startJob, Job, JobType } from "@/lib/jobs";

export type WorkerLogger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

/** Handles a single claimed job. Throw to fail it (JobError sets retry intent). */
export type JobHandler = (
  job: Job,
  ctx: { logger: WorkerLogger; signal?: AbortSignal; process?: ProcessOptions },
) => Promise<void>;

export type JobWorkerOptions = {
  /** Worker identity used for lock ownership. Defaults to a generated id. */
  workerId?: string;
  /** Idle wait between polls when no job is claimable (ms). Default 5000. */
  pollIntervalMs?: number;
  /** Lock lease length (ms) handed to claimNextJob. */
  lockTtlMs?: number;
  /** Restrict to specific job types. */
  types?: JobType[];
  /** Drain the queue once then stop (instead of polling forever). */
  once?: boolean;
  /** Cooperative stop signal. */
  signal?: AbortSignal;
  logger?: WorkerLogger;
  /** Override/extend the default per-type handlers. */
  handlers?: Partial<Record<JobType, JobHandler>>;
  /** Forwarded to processArticle for article jobs (e.g. tts / translateLangs). */
  process?: ProcessOptions;
  deps?: {
    claimNextJob?: typeof claimNextJob;
    startJob?: typeof startJob;
    completeJob?: typeof completeJob;
    failJob?: typeof failJob;
    processArticle?: typeof processArticle;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  };
};

export type JobWorkerStats = {
  polls: number;
  claimed: number;
  completed: number;
  failed: number;
  retried: number;
  deadLettered: number;
  stoppedBySignal: boolean;
};
