import { processArticle } from "@/lib/processing/processor";
import { createLogger } from "@/lib/observability/logger";
import { claimNextJob, completeJob, failJob, heartbeatJob, startJob, type JobType } from "@/lib/jobs";
import { createClaimedJobExecutor } from "./claimed-execution";
import type { ClaimedJobExecutionDeps } from "./claimed-execution";
import { sleep } from "./sleep";
import { createDefaultRegistry } from "./registry";
import { runWorkerLoop } from "./loop";
import type { WorkerLoopDeps } from "./loop";
import { runDiscoveryLoop } from "./discovery-loop";
import type { WorkerLogger, JobHandler, JobWorkerOptions, JobWorkerStats } from "./types";

export type { WorkerLogger, JobHandler, JobWorkerOptions, JobWorkerStats };
export { sleep } from "./sleep";
export { JobHandlerRegistry, makeArticleHandler, makeCandidateIngestHandler, createDefaultRegistry } from "./registry";
export type {
  CandidateIngestRow,
  LoadCandidateFn,
  CandidateIngestDeps,
  IngestAttemptRunner,
  IngestAttemptResult,
} from "./registry";
export { createClaimedJobExecutor } from "./claimed-execution";
export type {
  ClaimedJobExecutionDeps,
  ClaimedJobExecutionResult,
  ClaimedJobExecutor,
  ClaimedJobExecutorOptions,
} from "./claimed-execution";
export { runWorkerLoop } from "./loop";
export type { WorkerLoopOptions, WorkerLoopDeps } from "./loop";
export { runDiscoveryLoop } from "./discovery-loop";
export type { DiscoveryLoopOptions, DiscoveryLoopDeps, DiscoveryLoopStats } from "./discovery-loop";

/** Generates a stable-ish worker identity for lock ownership + tracing. */
export function generateWorkerId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `worker-${process.pid}-${rand}`;
}

/** Default logger: structured JSON lines (scope "worker") via {@link createLogger}. */
export function createConsoleLogger(): WorkerLogger {
  return createLogger("worker");
}

function buildHandlers(options: JobWorkerOptions, processFn: typeof processArticle): Partial<Record<JobType, JobHandler>> {
  return {
    ...createDefaultRegistry(processFn, undefined, options.candidateIngest ?? {}).toRecord(),
    ...options.handlers,
  };
}

function buildWorkerLoopDeps(options: JobWorkerOptions): WorkerLoopDeps {
  return {
    claimNextJob: options.deps?.claimNextJob ?? claimNextJob,
    sleep: options.deps?.sleep ?? sleep,
  };
}

function buildClaimedJobExecutionDeps(options: JobWorkerOptions): ClaimedJobExecutionDeps {
  return {
    startJob: options.deps?.startJob ?? startJob,
    heartbeatJob: options.deps?.heartbeatJob ?? heartbeatJob,
    completeJob: options.deps?.completeJob ?? completeJob,
    failJob: options.deps?.failJob ?? failJob,
  };
}

/**
 * Long-running worker that drains the persistent `Job` table. Claims one job at
 * a time (locked so multiple workers never run the same job), runs its handler,
 * and completes or fails it. Resumes pending work automatically after a restart
 * because the DB is the source of truth. Pass an AbortSignal to stop safely.
 *
 * This is the stable public entry point; internal concerns (loop, registry,
 * handlers) are split into `loop.ts`, `registry.ts`, and `types.ts`.
 */
export async function runJobWorker(options: JobWorkerOptions = {}): Promise<JobWorkerStats> {
  const workerId = options.workerId ?? generateWorkerId();
  const logger = options.logger ?? createConsoleLogger();
  const processFn = options.deps?.processArticle ?? processArticle;
  const handlers = buildHandlers(options, processFn);
  const executeClaimedJob = createClaimedJobExecutor(
    {
      workerId,
      handlers,
      logger,
      lockTtlMs: options.lockTtlMs,
      signal: options.signal,
      process: options.process,
    },
    buildClaimedJobExecutionDeps(options),
  );

  logger.info("job worker started", {
    workerId,
    pollIntervalMs: options.pollIntervalMs ?? 5000,
    once: Boolean(options.once),
    types: options.types ?? [],
    discovery: Boolean(options.discovery),
  });

  // The discovery scheduling pass (#1087) runs as a sibling under the SAME
  // worker runtime — not a second daemon — sharing the poll cadence, lease TTL,
  // stop signal, and `once` mode. It is only active when a `fetchPage` seam is
  // supplied; its failures are isolated in the run handler so they never affect
  // the Job loop.
  const discoveryPass = options.discovery
    ? runDiscoveryLoop(
        workerId,
        {
          pollIntervalMs: options.pollIntervalMs,
          once: options.once,
          signal: options.signal,
        },
        logger,
        options.discovery,
      )
    : null;

  const stats = await runWorkerLoop(
    workerId,
    executeClaimedJob,
    {
      pollIntervalMs: options.pollIntervalMs,
      lockTtlMs: options.lockTtlMs,
      types: options.types,
      once: options.once,
      signal: options.signal,
    },
    logger,
    buildWorkerLoopDeps(options),
  );

  if (discoveryPass) {
    const discoveryStats = await discoveryPass;
    logger.info("discovery scheduling pass stopped", { ...discoveryStats });
  }

  logger.info("job worker stopped", { ...stats });
  return stats;
}
