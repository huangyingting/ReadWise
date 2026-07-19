import type { ProcessOptions, processArticle } from "@/lib/processing/processor";
import type {
  claimNextJob,
  completeJob,
  failJob,
  heartbeatJob,
  startJob,
  Job,
  JobType,
} from "@/lib/jobs";
import type { DiscoveryLoopDeps } from "./discovery-loop";
import type { BackfillLoopDeps } from "./backfill-loop";
import type { CandidateIngestDeps } from "./registry";

export type WorkerLogger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

type JobWorkerDeps = {
  claimNextJob?: typeof claimNextJob;
  startJob?: typeof startJob;
  heartbeatJob?: typeof heartbeatJob;
  completeJob?: typeof completeJob;
  failJob?: typeof failJob;
  processArticle?: typeof processArticle;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
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
  /**
   * Enables the sibling discovery scheduling pass (issue #1087). Runs under the
   * SAME worker runtime (no second daemon). Omit to leave discovery scheduling
   * off; supply `deps.fetchPage` to activate it.
   */
  discovery?: DiscoveryLoopDeps;
  /**
   * Enables the sibling BACKFILL driver pass (issue #1101). Runs under the SAME
   * worker runtime (no second daemon): each tick advances every RUNNING
   * BackfillRun by one bounded batch, reactivating matching historical
   * identities at LOW priority. Pass `true` for the default driver, or a
   * {@link BackfillLoopDeps} to inject test doubles / a batch size. Omit to
   * leave historical backfill scheduling off.
   */
  backfill?: boolean | BackfillLoopDeps;
  /**
   * Candidate-based ARTICLE_INGEST dependencies (issue #1095): supply
   * `runIngestAttempt` (see `createIngestAttemptRunner`) to run the real
   * fetch/extract/atomic-save pipeline. Omitted → the candidate-ingest handler
   * stays a safe hand-off no-op.
   */
  candidateIngest?: CandidateIngestDeps;
  deps?: JobWorkerDeps;
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
