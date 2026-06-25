import { processArticle } from "@/lib/processing/processor";
import { createLogger } from "@/lib/observability/logger";
import { claimNextJob, completeJob, failJob, startJob, type JobType } from "@/lib/jobs";
import { sleep } from "./sleep";
import { createDefaultRegistry } from "./registry";
import { runWorkerLoop } from "./loop";
import type { WorkerLogger, JobHandler, JobWorkerOptions, JobWorkerStats } from "./types";

export type { WorkerLogger, JobHandler, JobWorkerOptions, JobWorkerStats };
export { sleep } from "./sleep";
export { JobHandlerRegistry, makeArticleHandler, createDefaultRegistry } from "./registry";
export { runWorkerLoop } from "./loop";
export type { WorkerLoopOptions, WorkerLoopDeps } from "./loop";

/** Generates a stable-ish worker identity for lock ownership + tracing. */
export function generateWorkerId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `worker-${process.pid}-${rand}`;
}

/** Default logger: structured JSON lines (scope "worker") via {@link createLogger}. */
export function createConsoleLogger(): WorkerLogger {
  return createLogger("worker");
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

  const registry = createDefaultRegistry(processFn);
  const handlers: Partial<Record<JobType, JobHandler>> = {
    ...registry.toRecord(),
    ...options.handlers,
  };

  logger.info("job worker started", {
    workerId,
    pollIntervalMs: options.pollIntervalMs ?? 5000,
    once: Boolean(options.once),
    types: options.types ?? [],
  });

  const stats = await runWorkerLoop(
    workerId,
    handlers,
    {
      pollIntervalMs: options.pollIntervalMs,
      lockTtlMs: options.lockTtlMs,
      types: options.types,
      once: options.once,
      signal: options.signal,
      process: options.process,
    },
    logger,
    {
      claimNextJob: options.deps?.claimNextJob ?? claimNextJob,
      startJob: options.deps?.startJob ?? startJob,
      completeJob: options.deps?.completeJob ?? completeJob,
      failJob: options.deps?.failJob ?? failJob,
      sleep: options.deps?.sleep ?? sleep,
    },
  );

  logger.info("job worker stopped", { ...stats });
  return stats;
}
