/**
 * Thin discovery-source observability persistence + query layer (issue #1089,
 * Phase 1.9).
 *
 * The PURE modules decide everything: `observability.ts` computes the metric
 * summary + derived operational status, and `degradation.ts` decides whether a
 * drifting source should be demoted. This module ONLY reads a metadata-only
 * snapshot from the database (the `DiscoverySource` row, per-status
 * `CrawlCandidate` counts, and recent observation timings), hands it to those
 * pure functions, and — for auto-degradation — APPLIES a `demote-to-shadow`
 * decision through the existing guarded `transitionDiscoveryLifecycle`
 * (ACTIVE→SHADOW is a safe, reversible "rollback" edge; NO checkpoint, candidate,
 * or watermark state is touched).
 *
 * Every value that leaves this layer is a controlled id, count, status,
 * duration, or sanitized category — it NEVER reads a URL/body/secret column into
 * a metric, and NEVER fetches a body, writes an Article, or enqueues ingest work
 * (AC4 + the governing invariant).
 */
import {
  CrawlCandidateStatus,
  DiscoverySourceLifecycleMode,
  type DiscoverySource,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";

import {
  decideDegradation,
  resolveDegradationThresholds,
  type DegradationReason,
  type ProviderThresholdOverrides,
} from "./degradation";
import {
  computeSourceMetrics,
  type CandidateStatusCounts,
  type DiscoveryVolumeBuckets,
  type SourceMetricSummary,
} from "./observability";
import { transitionDiscoveryLifecycle } from "./lifecycle-commit";

const log = createLogger("discovery-observability");

const M = DiscoverySourceLifecycleMode;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Cap on candidates sampled for the publication-to-discovery delay percentiles. */
const DELAY_SAMPLE_LIMIT = 500;

/** Identifying, metadata-only fields returned for every source in a list/detail. */
export type DiscoverySourceIdentity = {
  id: string;
  providerKey: string;
  sourceKey: string;
  definitionVersion: number;
};

/** A single source's summary: its identity + computed metric summary. */
export type DiscoverySourceMetricsDto = DiscoverySourceIdentity & {
  metrics: SourceMetricSummary;
};

// ---------------------------------------------------------------------------
// Snapshot assembly (metadata-only reads)
// ---------------------------------------------------------------------------

function candidateCountsFromGroups(
  groups: { status: CrawlCandidateStatus; _count: { _all: number } }[],
): CandidateStatusCounts {
  const counts: CandidateStatusCounts = {};
  for (const group of groups) counts[group.status] = group._count._all;
  return counts;
}

async function candidateCountsFor(sourceId: string): Promise<CandidateStatusCounts> {
  const groups = await prisma.crawlCandidate.groupBy({
    by: ["status"],
    where: { discoverySourceId: sourceId },
    _count: { _all: true },
  });
  return candidateCountsFromGroups(groups);
}

/**
 * Publication-to-discovery delays (ms) for recently observed dated candidates —
 * `firstObservedAt − trustedPublishedAt`. Reads ONLY the two timestamps (no
 * identity/URL), capped and clamped to non-negative durations.
 */
async function publicationDelaysFor(sourceId: string): Promise<number[]> {
  const rows = await prisma.crawlCandidate.findMany({
    where: { discoverySourceId: sourceId, trustedPublishedAt: { not: null } },
    select: { trustedPublishedAt: true, firstObservedAt: true },
    orderBy: { firstObservedAt: "desc" },
    take: DELAY_SAMPLE_LIMIT,
  });
  const delays: number[] = [];
  for (const row of rows) {
    if (!row.trustedPublishedAt) continue;
    const ms = row.firstObservedAt.getTime() - row.trustedPublishedAt.getTime();
    if (ms >= 0) delays.push(ms);
  }
  return delays;
}

/**
 * Discovery-volume buckets from `firstObservedAt`: the count in the most recent
 * 24h vs the daily mean across the preceding week. Plain counts only.
 */
async function volumeBucketsFor(sourceId: string, now: Date): Promise<DiscoveryVolumeBuckets> {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const [recentDayCount, priorWeekCount] = await Promise.all([
    prisma.crawlCandidate.count({
      where: { discoverySourceId: sourceId, firstObservedAt: { gte: dayAgo } },
    }),
    prisma.crawlCandidate.count({
      where: { discoverySourceId: sourceId, firstObservedAt: { gte: weekAgo, lt: dayAgo } },
    }),
  ]);
  return { recentDayCount, baselineDailyMean: priorWeekCount / 6 };
}

function identityOf(source: DiscoverySource): DiscoverySourceIdentity {
  return {
    id: source.id,
    providerKey: source.providerKey,
    sourceKey: source.sourceKey,
    definitionVersion: source.definitionVersion,
  };
}

function snapshotOf(source: DiscoverySource) {
  return {
    role: source.role,
    lifecycleMode: source.lifecycleMode,
    automationPolicy: source.automationPolicy,
    health: source.health,
    gapState: source.gapState,
    gapDetectedAt: source.gapDetectedAt,
    watermarkAt: source.watermarkAt,
    baselineCompletedAt: source.baselineCompletedAt,
    baselineObservedCount: source.baselineObservedCount,
    lastRunAt: source.lastRunAt,
    nextRunAt: source.nextRunAt,
    activatedAt: source.activatedAt,
    backoffLevel: source.backoffLevel,
    backoffUntil: source.backoffUntil,
    consecutiveFailures: source.consecutiveFailures,
    consecutiveZeroDiscoveryRuns: source.consecutiveZeroDiscoveryRuns,
    discoveryBudgetPerRun: source.discoveryBudgetPerRun,
  };
}

// ---------------------------------------------------------------------------
// Public queries (admin API DTOs)
// ---------------------------------------------------------------------------

/** Filter for {@link listDiscoverySourceMetrics}. */
export type ListDiscoverySourcesFilter = {
  providerKey?: string;
  lifecycleMode?: DiscoverySourceLifecycleMode;
  /** Max rows returned (defaults to 200). */
  limit?: number;
};

/**
 * Lists sources with their computed metric summaries. Candidate counts are read
 * per source in one grouped query per source; the list is intended for admin
 * dashboards, so it is bounded by `limit`.
 */
export async function listDiscoverySourceMetrics(
  filter: ListDiscoverySourcesFilter = {},
  now: Date = new Date(),
): Promise<DiscoverySourceMetricsDto[]> {
  const where: Prisma.DiscoverySourceWhereInput = {};
  if (filter.providerKey) where.providerKey = filter.providerKey;
  if (filter.lifecycleMode) where.lifecycleMode = filter.lifecycleMode;

  const sources = await prisma.discoverySource.findMany({
    where,
    orderBy: [{ providerKey: "asc" }, { sourceKey: "asc" }],
    take: Math.min(filter.limit ?? 200, 500),
  });

  const dtos: DiscoverySourceMetricsDto[] = [];
  for (const source of sources) {
    const candidateCounts = await candidateCountsFor(source.id);
    dtos.push({
      ...identityOf(source),
      metrics: computeSourceMetrics({ now, source: snapshotOf(source), candidateCounts }),
    });
  }
  return dtos;
}

/**
 * Returns the full metric summary for ONE source (including delay percentiles +
 * volume anomaly), or `null` when the source does not exist.
 */
export async function getDiscoverySourceMetrics(
  sourceId: string,
  now: Date = new Date(),
): Promise<DiscoverySourceMetricsDto | null> {
  const source = await prisma.discoverySource.findUnique({ where: { id: sourceId } });
  if (!source) return null;

  const [candidateCounts, publicationToDiscoveryDelaysMs, volume] = await Promise.all([
    candidateCountsFor(sourceId),
    publicationDelaysFor(sourceId),
    volumeBucketsFor(sourceId, now),
  ]);

  return {
    ...identityOf(source),
    metrics: computeSourceMetrics({
      now,
      source: snapshotOf(source),
      candidateCounts,
      publicationToDiscoveryDelaysMs,
      volume,
    }),
  };
}

// ---------------------------------------------------------------------------
// Auto-degradation (run-finalizer hook)
// ---------------------------------------------------------------------------

/** Inputs to {@link evaluateAndApplyDegradation}. */
export type EvaluateDegradationInput = {
  /** The claimed source (still lease-held by the finishing worker). */
  source: Pick<
    DiscoverySource,
    "id" | "providerKey" | "lifecycleMode" | "leaseOwner" | "definitionVersion" | "watermarkAt" | "consecutiveFailures"
  >;
  /** The zero-discovery streak AFTER this run (see `nextZeroDiscoveryStreak`). */
  zeroDiscoveryStreak: number;
  now: Date;
  /** Provider-aware threshold overrides (optional). */
  thresholdOverrides?: ProviderThresholdOverrides;
  /** Injected transition applier (defaults to the guarded lifecycle commit). */
  applyTransition?: typeof transitionDiscoveryLifecycle;
  logger?: { info: (m: string, meta?: Record<string, unknown>) => void; warn: (m: string, meta?: Record<string, unknown>) => void };
};

/** Result of an auto-degradation evaluation. */
export type EvaluateDegradationResult = {
  demoted: boolean;
  reason: DegradationReason;
};

/**
 * Evaluates the pure degradation decision for a just-finished run and, when it
 * says `demote-to-shadow`, applies the guarded ACTIVE→SHADOW transition under
 * the worker's own lease. NEVER throws: any persistence error is caught and
 * logged (redacted), so a degradation failure can never break the discovery loop
 * (failure isolation). The demotion preserves all checkpoint/candidate/watermark
 * state and is reversible via the normal SHADOW→ACTIVE activation.
 */
export async function evaluateAndApplyDegradation(
  input: EvaluateDegradationInput,
): Promise<EvaluateDegradationResult> {
  const logger = input.logger ?? log;
  const thresholds = resolveDegradationThresholds(
    input.source.providerKey,
    input.thresholdOverrides,
  );
  const watermarkStallMs =
    input.source.watermarkAt === null
      ? null
      : input.now.getTime() - input.source.watermarkAt.getTime();

  const decision = decideDegradation(
    {
      lifecycleMode: input.source.lifecycleMode,
      zeroDiscoveryStreak: input.zeroDiscoveryStreak,
      watermarkStallMs,
      consecutiveFailures: input.source.consecutiveFailures,
    },
    thresholds,
  );

  if (decision.action !== "demote-to-shadow") {
    return { demoted: false, reason: decision.reason };
  }
  if (!input.source.leaseOwner) {
    return { demoted: false, reason: decision.reason };
  }

  try {
    const apply = input.applyTransition ?? transitionDiscoveryLifecycle;
    const result = await apply({
      sourceId: input.source.id,
      leaseOwner: input.source.leaseOwner,
      definitionVersion: input.source.definitionVersion,
      targetMode: M.SHADOW,
      now: input.now,
    });
    if (result.committed) {
      logger.info("discovery source auto-degraded to shadow", {
        sourceId: input.source.id,
        reason: decision.reason,
        zeroDiscoveryStreak: input.zeroDiscoveryStreak,
      });
      return { demoted: true, reason: decision.reason };
    }
    logger.warn("discovery source auto-degradation not committed", {
      sourceId: input.source.id,
      reason: decision.reason,
      commitReason: result.reason,
    });
    return { demoted: false, reason: decision.reason };
  } catch (error) {
    logger.warn("discovery source auto-degradation failed", {
      sourceId: input.source.id,
      reason: decision.reason,
      error: error instanceof Error ? error.name : "Error",
    });
    return { demoted: false, reason: decision.reason };
  }
}
