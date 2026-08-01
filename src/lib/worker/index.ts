import { processArticle } from "@/lib/processing/processor";
import { createLogger } from "@/lib/observability/logger";
import {
  claimNextJob,
  completeJob,
  failJob,
  heartbeatJob,
  startJob,
  type JobType,
} from "@/lib/jobs";
import { DEFAULT_LOCK_TTL_MS, MIN_LOCK_TTL_MS } from "@/lib/jobs/types";
import { createClaimedJobExecutor } from "./claimed-execution";
import type { ClaimedJobExecutionDeps } from "./claimed-execution";
import { sleep } from "./sleep";
import { createDefaultRegistry } from "./registry";
import { runWorkerLoop } from "./loop";
import type { WorkerLoopDeps } from "./loop";
import { runDiscoveryLoop } from "./discovery-loop";
import { runBackfillLoop } from "./backfill-loop";
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
export { runBackfillLoop } from "./backfill-loop";
export type { BackfillLoopOptions, BackfillLoopDeps, BackfillLoopStats } from "./backfill-loop";

/**
 * Smallest shared job/discovery lease accepted by the worker runtime.
 * Discovery performs a bounded 15-second network request before committing,
 * while job heartbeats have a 1-second scheduling floor; shorter leases can be
 * reclaimed before their owner has a realistic chance to renew or release.
 */
export const MIN_WORKER_LOCK_TTL_MS = MIN_LOCK_TTL_MS;

function safeWorkerLockTtlMs(lockTtlMs: number | undefined): number | undefined {
  if (lockTtlMs === undefined) return undefined;
  if (!Number.isFinite(lockTtlMs) || lockTtlMs < MIN_WORKER_LOCK_TTL_MS) {
    return DEFAULT_LOCK_TTL_MS;
  }
  return lockTtlMs;
}

/** Generates a stable-ish worker identity for lock ownership + tracing. */
export function generateWorkerId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `worker-${process.pid}-${rand}`;
}

/** Default logger: structured JSON lines (scope "worker") via {@link createLogger}. */
export function createConsoleLogger(): WorkerLogger {
  return createLogger("worker");
}

function createRuntimeController(parentSignal?: AbortSignal): {
  controller: AbortController;
  detach: () => void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort(parentSignal?.reason);

  if (parentSignal?.aborted) {
    abort();
  } else {
    parentSignal?.addEventListener("abort", abort, { once: true });
  }

  return {
    controller,
    detach: () => parentSignal?.removeEventListener("abort", abort),
  };
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
  const lockTtlMs = safeWorkerLockTtlMs(options.lockTtlMs);
  const processFn = options.deps?.processArticle ?? processArticle;
  const handlers = buildHandlers(options, processFn);
  const runtime = createRuntimeController(options.signal);
  const runtimeSignal = runtime.controller.signal;
  const executeClaimedJob = createClaimedJobExecutor(
    {
      workerId,
      handlers,
      logger,
      lockTtlMs,
      signal: runtimeSignal,
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
          lockTtlMs,
          once: options.once,
          signal: runtimeSignal,
        },
        logger,
        options.discovery,
      )
    : null;

  // The historical-backfill driver pass (#1101) runs as a sibling under the SAME
  // worker runtime, advancing every RUNNING BackfillRun one bounded batch per
  // tick. Enabled by `options.backfill` (a `true` uses the default driver; a
  // deps object injects test doubles). Its low-priority ingest Jobs are always
  // claimed after real-time work, and a failing run never affects the Job loop.
  const backfillPass = options.backfill
    ? runBackfillLoop(
        workerId,
        {
          pollIntervalMs: options.pollIntervalMs,
          once: options.once,
          signal: runtimeSignal,
        },
        logger,
        options.backfill === true ? {} : options.backfill,
      )
    : null;

  const jobPass = runWorkerLoop(
    workerId,
    executeClaimedJob,
    {
      pollIntervalMs: options.pollIntervalMs,
      lockTtlMs,
      types: options.types,
      once: options.once,
      signal: runtimeSignal,
    },
    logger,
    buildWorkerLoopDeps(options),
  );
  const passes: Promise<unknown>[] = [jobPass];
  if (discoveryPass) passes.push(discoveryPass);
  if (backfillPass) passes.push(backfillPass);

  try {
    const [stats, discoveryStats, backfillStats] = await Promise.all([
      jobPass,
      discoveryPass ?? Promise.resolve(null),
      backfillPass ?? Promise.resolve(null),
    ] as const);

    if (discoveryStats) {
      logger.info("discovery scheduling pass stopped", { ...discoveryStats });
    }

    if (backfillStats) {
      logger.info("backfill driver pass stopped", { ...backfillStats });
    }

    logger.info("job worker stopped", { ...stats });
    return stats;
  } catch (err) {
    runtime.controller.abort();
    await Promise.allSettled(passes);
    throw err;
  } finally {
    runtime.detach();
  }
}
