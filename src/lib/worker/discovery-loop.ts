import { claimDueDiscoverySource } from "@/lib/scraper/incremental/discovery-claim";
import {
  runClaimedDiscoverySource,
  type DiscoveryPageFetcher,
  type RunClaimedDiscoverySourceDeps,
} from "@/lib/scraper/incremental/discovery-run";
import { sleep, isAbort } from "./sleep";
import type { WorkerLogger } from "./types";

/** Options forwarded to the discovery scheduling pass. */
export type DiscoveryLoopOptions = {
  pollIntervalMs?: number;
  lockTtlMs?: number;
  once?: boolean;
  signal?: AbortSignal;
};

/** Injectable dependencies for the discovery pass (all default to real ones except `fetchPage`). */
export type DiscoveryLoopDeps = {
  /** Fetches ONE bounded page for a claimed source (required to activate the pass). */
  fetchPage: DiscoveryPageFetcher;
  claimDueDiscoverySource?: typeof claimDueDiscoverySource;
  runClaimedDiscoverySource?: typeof runClaimedDiscoverySource;
  sleep?: typeof sleep;
} & Omit<RunClaimedDiscoverySourceDeps, "fetchPage">;

export type DiscoveryLoopStats = {
  polls: number;
  claimed: number;
  committed: number;
  failed: number;
  leaseLost: number;
  stoppedBySignal: boolean;
};

function initialStats(): DiscoveryLoopStats {
  return { polls: 0, claimed: 0, committed: 0, failed: 0, leaseLost: 0, stoppedBySignal: false };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Sibling scheduling pass driven by the SAME worker runtime (NOT a second
 * daemon): polls {@link claimDueDiscoverySource}, and for each claimed source
 * runs exactly one bounded page via {@link runClaimedDiscoverySource}. Failure
 * isolation lives in the run handler (a failing source never throws here), so a
 * single bad provider can never stop the pass or the Job loop. Stops when the
 * signal fires or (in `once` mode) when no source is due.
 */
export async function runDiscoveryLoop(
  workerId: string,
  options: DiscoveryLoopOptions,
  logger: WorkerLogger,
  deps: DiscoveryLoopDeps,
): Promise<DiscoveryLoopStats> {
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const signal = options.signal;
  const claimFn = deps.claimDueDiscoverySource ?? claimDueDiscoverySource;
  const runFn = deps.runClaimedDiscoverySource ?? runClaimedDiscoverySource;
  const sleepFn = deps.sleep ?? sleep;
  const runDeps: RunClaimedDiscoverySourceDeps = {
    fetchPage: deps.fetchPage,
    commitPage: deps.commitPage,
    commitFrontier: deps.commitFrontier,
    now: deps.now,
  };
  const stats = initialStats();

  try {
    for (;;) {
      if (signal?.aborted) {
        stats.stoppedBySignal = true;
        break;
      }

      stats.polls++;
      const claimed = await claimFn(workerId, { lockTtlMs: options.lockTtlMs });

      if (!claimed) {
        if (options.once) {
          logger.info("no discovery source due, stopping (once mode)");
          break;
        }
        await sleepFn(pollIntervalMs, signal);
        continue;
      }

      stats.claimed++;
      const outcome = await runFn(claimed, logger, runDeps, signal);
      switch (outcome.status) {
        case "committed":
          stats.committed++;
          break;
        case "failed":
          stats.failed++;
          break;
        case "lease-lost":
          stats.leaseLost++;
          break;
      }
    }
  } catch (err) {
    if (isAbort(err)) {
      stats.stoppedBySignal = true;
    } else {
      logger.error("discovery loop crashed", { error: errorMessage(err) });
      throw err;
    }
  }

  return stats;
}
