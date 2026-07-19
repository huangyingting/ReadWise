/**
 * Bounded, resumable discovery-source run handler (issue #1087, Phase 1.7).
 *
 * A single claim runs a SINGLE bounded page for the claimed source, so a crashed
 * worker resumes from the last durably-committed checkpoint (bounding each claim
 * is preferred over heartbeating a long scan — it keeps leases short). The
 * handler:
 *
 *   1. fetches ONE page via the injected #1084 fetch seam (network stays out of
 *      every transaction);
 *   2. commits the page atomically (`commitDiscoveryPage`, #1085) — which
 *      revalidates lease ownership + `definitionVersion` on the guarded
 *      checkpoint advance, so two workers can never process one source/version
 *      concurrently, and creates NO Article / body-fetch / ingest job;
 *   3. persists run health + `lastRunAt` (`commitFrontierState`, #1086) using the
 *      pure `decideRunCompletion` accounting;
 *   4. computes + persists the next `nextRunAt` and RELEASES the lease under the
 *      same guarded (lease + version) update.
 *
 * Failure isolation: ANY error is caught, converted to a REDACTED metadata-only
 * `lastError`, escalates the failure backoff, and still releases the lease so one
 * failing provider can never stop the loop or block other sources. The handler
 * NEVER throws to the loop and NEVER enqueues body work.
 */
import { DiscoverySourceHealth, DiscoverySourceLifecycleMode, type DiscoverySource } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { redactUrlForLog } from "@/lib/scraper/url-redaction";

import { commitDiscoveryPage } from "./page-commit";
import type { DiscoveryPageResult } from "./page-commit";
import { commitFrontierState } from "./frontier-commit";
import { decideRunCompletion } from "./frontier";
import { computeNextRunAt, failureBackoffSeconds } from "./schedule";
import { nextZeroDiscoveryStreak } from "./degradation";
import { evaluateAndApplyDegradation } from "./observability-query";
import type { ClaimedDiscoverySource } from "./discovery-claim";

const SECOND_MS = 1000;
const MAX_LAST_ERROR_LENGTH = 500;

export type WorkerLoggerLike = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

/**
 * Fetches ONE bounded discovery page for the claimed source. Built on the #1084
 * `fetchDiscoveryResponse` seam; injected so the run handler needs no network in
 * tests. MUST NOT persist anything — the handler commits atomically.
 */
export type DiscoveryPageFetcher = (input: {
  source: DiscoverySource;
  signal?: AbortSignal;
}) => Promise<DiscoveryPageResult>;

export type RunClaimedDiscoverySourceDeps = {
  fetchPage: DiscoveryPageFetcher;
  commitPage?: typeof commitDiscoveryPage;
  commitFrontier?: typeof commitFrontierState;
  now?: () => Date;
};

export type DiscoveryRunOutcome =
  | {
      status: "committed";
      itemsCommitted: number;
      boundaryReached: boolean;
      caughtUp: boolean;
    }
  | { status: "lease-lost" }
  | { status: "failed"; errorKind: string };

/** Renders an error as bounded, secret-free metadata (never a raw URL/query). */
export function redactErrorForSource(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = raw.replace(/https?:\/\/\S+/g, (match) => redactUrlForLog(match));
  return redacted.slice(0, MAX_LAST_ERROR_LENGTH);
}

/**
 * Persists the outcome of a completed page run and RELEASES the lease under a
 * guarded (lease + version) update. A zero-row update means the lease was lost
 * mid-run → nothing is persisted (the caller already committed the page/frontier
 * under the same guard).
 */
async function releaseSource(
  source: DiscoverySource,
  data: Record<string, unknown>,
  now: Date,
): Promise<boolean> {
  const updated = await prisma.discoverySource.updateMany({
    where: {
      id: source.id,
      leaseOwner: source.leaseOwner,
      definitionVersion: source.definitionVersion,
    },
    data: {
      leaseOwner: null,
      leaseAcquiredAt: null,
      leaseExpiresAt: null,
      updatedAt: now,
      ...data,
    },
  });
  return updated.count > 0;
}

/** nextRunAt for a successful page: immediate when more pages remain, else cadence. */
function nextRunAtAfterSuccess(source: DiscoverySource, boundaryReached: boolean, now: Date): Date | null {
  if (!boundaryReached) return now; // resume the advanced checkpoint on the next poll
  return computeNextRunAt({
    now,
    role: source.role,
    automationPolicy: source.automationPolicy,
    lifecycleMode: source.lifecycleMode,
    pollIntervalSeconds: source.pollIntervalSeconds,
    scheduleCron: source.scheduleCron,
    backoffLevel: 0,
  });
}

async function finalizeSuccess(
  source: DiscoverySource,
  boundaryReached: boolean,
  now: Date,
  zeroDiscoveryStreak: number,
): Promise<boolean> {
  return releaseSource(
    source,
    {
      nextRunAt: nextRunAtAfterSuccess(source, boundaryReached, now),
      lastRunAt: now,
      backoffLevel: 0,
      consecutiveFailures: 0,
      consecutiveZeroDiscoveryRuns: zeroDiscoveryStreak,
      backoffUntil: null,
      lastError: null,
    },
    now,
  );
}

async function finalizeFailure(source: DiscoverySource, error: unknown, now: Date): Promise<void> {
  const backoffLevel = source.backoffLevel + 1;
  const backoffUntil = new Date(now.getTime() + failureBackoffSeconds(backoffLevel) * SECOND_MS);
  const nextRunAt = computeNextRunAt({
    now,
    role: source.role,
    automationPolicy: source.automationPolicy,
    lifecycleMode: source.lifecycleMode,
    pollIntervalSeconds: source.pollIntervalSeconds,
    scheduleCron: source.scheduleCron,
    backoffLevel,
  });

  await releaseSource(
    source,
    {
      nextRunAt,
      lastRunAt: now,
      backoffLevel,
      consecutiveFailures: source.consecutiveFailures + 1,
      backoffUntil,
      health: DiscoverySourceHealth.FAILING,
      lastError: redactErrorForSource(error),
    },
    now,
  );
}

/**
 * Runs one bounded page for a freshly-claimed discovery source. Never throws:
 * a failing source is isolated (backoff + redacted error, lease released) so the
 * loop and other sources are unaffected.
 */
export async function runClaimedDiscoverySource(
  claimed: ClaimedDiscoverySource,
  logger: WorkerLoggerLike,
  deps: RunClaimedDiscoverySourceDeps,
  signal?: AbortSignal,
): Promise<DiscoveryRunOutcome> {
  const source = claimed.source;
  const leaseOwner = source.leaseOwner;
  if (!leaseOwner) return { status: "lease-lost" };

  const now = deps.now?.() ?? new Date();
  const commitPage = deps.commitPage ?? commitDiscoveryPage;
  const commitFrontier = deps.commitFrontier ?? commitFrontierState;
  const definitionVersion = source.definitionVersion;

  try {
    const page = await deps.fetchPage({ source, signal });

    const pageResult = await commitPage({
      sourceId: source.id,
      leaseOwner,
      definitionVersion,
      page,
      now,
    });
    if (!pageResult.committed) {
      logger.warn("discovery page not committed", {
        sourceId: source.id,
        reason: pageResult.reason,
      });
      return { status: "lease-lost" };
    }

    const completion = decideRunCompletion({
      boundaryReached: pageResult.boundaryReached,
      pagesFullyProcessed: true,
    });

    const frontier = await commitFrontier({
      sourceId: source.id,
      leaseOwner,
      definitionVersion,
      decision: { health: completion.health, runAt: now },
      now,
    });
    if (!frontier.committed) {
      logger.warn("discovery frontier not committed", {
        sourceId: source.id,
        reason: frontier.reason,
      });
      return { status: "lease-lost" };
    }

    // Auto-degradation (#1089): a sustained HTTP-200/zero-discovery drift (or a
    // stalled watermark) demotes an ACTIVE source back to SHADOW under the still-
    // held lease, WITHOUT touching checkpoint/candidate/watermark state and
    // reversibly. `nextZeroDiscoveryStreak` counts a boundary-reached scan that
    // discovered no NEW eligible identities; any new discovery resets it. The
    // evaluation is no-throw so a degradation fault never breaks the loop.
    const newlyDiscovered = pageResult.outcomes.eligible;
    const zeroDiscoveryStreak = nextZeroDiscoveryStreak({
      previousStreak: source.consecutiveZeroDiscoveryRuns,
      boundaryReached: pageResult.boundaryReached,
      newlyDiscovered,
    });
    const degradation = await evaluateAndApplyDegradation({
      source,
      zeroDiscoveryStreak,
      now,
      logger,
    });
    if (degradation.demoted) source.lifecycleMode = DiscoverySourceLifecycleMode.SHADOW;

    const finalized = await finalizeSuccess(source, pageResult.boundaryReached, now, zeroDiscoveryStreak);
    if (!finalized) return { status: "lease-lost" };

    return {
      status: "committed",
      itemsCommitted: pageResult.itemsCommitted,
      boundaryReached: pageResult.boundaryReached,
      caughtUp: completion.caughtUp,
    };
  } catch (error) {
    logger.warn("discovery source run failed", {
      sourceId: source.id,
      error: redactErrorForSource(error),
    });
    await finalizeFailure(source, error, now);
    return { status: "failed", errorKind: error instanceof Error ? error.name : "Error" };
  }
}
