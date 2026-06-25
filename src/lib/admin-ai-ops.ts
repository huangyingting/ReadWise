/**
 * AI cost & content-operations admin intelligence (Epic RW-E010 — RW-054).
 *
 * Surfaces the durable operational records — the `AiInvocation` ledger, the
 * `ArticleProcessingStep` timeline, and the `Job` queue — as dashboards an
 * operator can act on:
 *   - {@link getAiCostOverview}: AI spend / volume / latency / fallback rates
 *     broken down by feature, model, status, user and article so expensive,
 *     failing, or high-fallback features stand out.
 *   - {@link getContentOpsOverview}: the enrichment pipeline's health —
 *     per-step generated/skipped/fallback/failed counts, the articles with
 *     failing steps, and the job-queue backlog. Now lives in the processing
 *     subsystem (REF-025); re-exported here for backward compatibility.
 *
 * This module only READS those tables (it never writes the ledger / steps); it
 * reuses {@link summarizeAiUsage} for the headline rollups and adds the extra
 * groupings via direct `prisma` aggregates. Everything degrades gracefully —
 * an empty ledger / empty pipeline yields zeroed structures, never throws.
 */
import { prisma } from "@/lib/prisma";
import {
  summarizeAiUsage,
  type AiUsageSummary,
  type AiUsageGroup,
} from "@/lib/ai-usage-summary";

/** Prisma surface the AI cost helper needs (injectable in tests). */
type AiClient = Pick<typeof prisma, "aiInvocation">;

const DEFAULT_WINDOW_HOURS = 24 * 7;
const TOP_LIMIT = 10;

export type LatencyStats = {
  avgMs: number | null;
  maxMs: number | null;
};

/** A per-entity AI usage row with the fallback rate broken out. */
export type AiEntityUsage = AiUsageGroup & {
  fallbackCount: number;
  fallbackRatePct: number;
};

export type AiCostOverview = {
  windowHours: number;
  range: { since: string; until: string };
  summary: AiUsageSummary;
  latency: LatencyStats;
  /** Features ranked by estimated cost (highest first). */
  byFeatureCost: AiEntityUsage[];
  /** Top spenders by user id (nulls collapsed into "anonymous/system"). */
  topUsers: AiEntityUsage[];
  /** Top spenders by article id. */
  topArticles: AiEntityUsage[];
  /** Features whose fallback rate is notably high (>= 25%). */
  highFallbackFeatures: AiEntityUsage[];
};

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function roundCost(value: number | null | undefined): number {
  if (!value || !Number.isFinite(value)) return 0;
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Builds the AI cost / volume / latency / fallback overview for the last
 * `hours` window. Reuses {@link summarizeAiUsage} for the headline rollups and
 * adds latency + per-user/article/fallback groupings via direct aggregates.
 */
export async function getAiCostOverview(
  opts: { hours?: number; now?: Date; client?: AiClient } = {},
): Promise<AiCostOverview> {
  const client = opts.client ?? prisma;
  const now = opts.now ?? new Date();
  const windowHours =
    Number.isFinite(opts.hours) && (opts.hours ?? 0) > 0
      ? Math.floor(opts.hours as number)
      : DEFAULT_WINDOW_HOURS;
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const where = { createdAt: { gte: since, lt: now } } as const;

  const [summary, latencyAgg, byFeatureFallback, byUser, byUserFallback, byArticle] =
    await Promise.all([
      summarizeAiUsage({ since, until: now }, client),
      client.aiInvocation.aggregate({
        where,
        _avg: { latencyMs: true },
        _max: { latencyMs: true },
      }),
      client.aiInvocation.groupBy({
        by: ["feature"],
        where: { ...where, fallback: true },
        _count: { _all: true },
      }),
      client.aiInvocation.groupBy({
        by: ["userId"],
        where,
        _count: { _all: true },
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
        },
      }),
      client.aiInvocation.groupBy({
        by: ["userId"],
        where: { ...where, fallback: true },
        _count: { _all: true },
      }),
      client.aiInvocation.groupBy({
        by: ["articleId"],
        where,
        _count: { _all: true },
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
        },
      }),
    ]);

  const fallbackByFeature = new Map<string, number>();
  for (const row of byFeatureFallback) {
    fallbackByFeature.set(row.feature ?? "unknown", row._count._all);
  }

  const byFeatureCost: AiEntityUsage[] = summary.byFeature
    .map((g) => {
      const fallbackCount = fallbackByFeature.get(g.key) ?? 0;
      return {
        ...g,
        estimatedCostUsd: roundCost(g.estimatedCostUsd),
        fallbackCount,
        fallbackRatePct: pct(fallbackCount, g.count),
      };
    })
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

  const highFallbackFeatures = byFeatureCost
    .filter((g) => g.count >= 3 && g.fallbackRatePct >= 25)
    .sort((a, b) => b.fallbackRatePct - a.fallbackRatePct);

  const fallbackByUser = new Map<string, number>();
  for (const row of byUserFallback) {
    fallbackByUser.set(row.userId ?? "—", row._count._all);
  }

  const mapGroup = (
    rows: Array<{
      _count: { _all: number };
      _sum: {
        promptTokens: number | null;
        completionTokens: number | null;
        totalTokens: number | null;
        estimatedCostUsd: number | null;
      };
    } & Record<string, unknown>>,
    field: string,
    fallbackMap?: Map<string, number>,
  ): AiEntityUsage[] =>
    rows
      .map((row) => {
        const key = (row[field] as string | null) ?? "—";
        const count = row._count._all;
        const fallbackCount = fallbackMap?.get(key) ?? 0;
        return {
          key,
          count,
          promptTokens: row._sum.promptTokens ?? 0,
          completionTokens: row._sum.completionTokens ?? 0,
          totalTokens: row._sum.totalTokens ?? 0,
          estimatedCostUsd: roundCost(row._sum.estimatedCostUsd),
          fallbackCount,
          fallbackRatePct: pct(fallbackCount, count),
        };
      })
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.count - a.count)
      .slice(0, TOP_LIMIT);

  return {
    windowHours,
    range: { since: since.toISOString(), until: now.toISOString() },
    summary,
    latency: {
      avgMs:
        latencyAgg._avg.latencyMs != null
          ? Math.round(latencyAgg._avg.latencyMs)
          : null,
      maxMs: latencyAgg._max.latencyMs ?? null,
    },
    byFeatureCost,
    topUsers: mapGroup(byUser, "userId", fallbackByUser),
    topArticles: mapGroup(byArticle, "articleId").filter((g) => g.key !== "—"),
    highFallbackFeatures,
  };
}

// ---------------------------------------------------------------------------
// Content operations — re-exported from the processing subsystem (REF-025)
// ---------------------------------------------------------------------------

export {
  type StepStatusCounts,
  type StepBreakdown,
  type ProblemArticle,
  type ContentOpsOverview,
  getContentOpsOverview,
} from "@/lib/processing/admin-ops";
