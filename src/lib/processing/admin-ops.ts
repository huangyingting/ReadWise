/**
 * Content-operations admin read model (REF-025).
 *
 * Surfaces the durable `ArticleProcessingStep` timeline and the `Job` queue as a
 * dashboard an operator can act on:
 *   - {@link getContentOpsOverview}: the enrichment pipeline's health —
 *     per-step generated/skipped/fallback/failed counts, the articles with
 *     failing steps, and the job-queue backlog.
 *
 * This module only READS those tables (it never writes the ledger / steps). It
 * derives its step vocabulary from the canonical feature registry so the
 * dashboard and the processing pipeline always agree. Degrades gracefully —
 * an empty pipeline yields zeroed structures, never throws.
 */
import { prisma } from "@/lib/prisma";
import {
  summarizeAiUsage,
  type AiUsageSummary,
  type AiUsageGroup,
} from "@/lib/ai-usage-summary";
import {
  getJobDashboard,
  type JobDashboard,
} from "@/lib/admin-jobs";
import {
  PROCESSING_STEPS,
  PROCESSING_STEP_STATUSES,
  type ProcessingStepStatus,
} from "./state";

/** Prisma surface the AI cost helper needs (injectable in tests). */
type AiClient = Pick<typeof prisma, "aiInvocation">;
/** Prisma surfaces the helper needs (injectable in tests). */
type StepClient = Pick<typeof prisma, "articleProcessingStep" | "article">;

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
  byFeatureCost: AiEntityUsage[];
  topUsers: AiEntityUsage[];
  topArticles: AiEntityUsage[];
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

export type StepStatusCounts = Record<ProcessingStepStatus, number> & {
  total: number;
};

export type StepBreakdown = {
  step: string;
  counts: StepStatusCounts;
};

export type ProblemArticle = {
  articleId: string;
  title: string | null;
  status: string;
  failed: number;
  fallback: number;
  steps: { step: string; status: string; lastError: string | null }[];
};

export type ContentOpsOverview = {
  /** Per-step status counts across the whole pipeline. */
  steps: StepBreakdown[];
  /** Rolled-up status totals across every step. */
  totals: StepStatusCounts;
  /** Articles with at least one failed/fallback step (most-problematic first). */
  problemArticles: ProblemArticle[];
  /** The job-queue health (backlog / failures / dead-letter). */
  jobs: JobDashboard;
};

function emptyStepCounts(): StepStatusCounts {
  const counts = { total: 0 } as StepStatusCounts;
  for (const status of PROCESSING_STEP_STATUSES) counts[status] = 0;
  return counts;
}

/**
 * Builds the content-operations overview from the durable
 * `ArticleProcessingStep` timeline + the job queue: per-step status counts, the
 * articles with failing/fallback steps, and the queue backlog.
 */
export async function getContentOpsOverview(
  opts: { client?: StepClient; jobDashboard?: JobDashboard } = {},
): Promise<ContentOpsOverview> {
  const client = opts.client ?? prisma;

  const [grouped, problemRows, jobs] = await Promise.all([
    client.articleProcessingStep.groupBy({
      by: ["step", "status"],
      _count: { _all: true },
    }),
    client.articleProcessingStep.findMany({
      where: { status: { in: ["failed", "fallback"] } },
      select: {
        articleId: true,
        step: true,
        status: true,
        lastError: true,
        updatedAt: true,
        article: { select: { title: true, status: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    opts.jobDashboard ? Promise.resolve(opts.jobDashboard) : getJobDashboard(),
  ]);

  // Per-step + rolled-up status counts.
  const stepMap = new Map<string, StepStatusCounts>();
  for (const step of PROCESSING_STEPS) stepMap.set(step, emptyStepCounts());
  const totals = emptyStepCounts();
  for (const row of grouped) {
    const step = row.step;
    const status = row.status as ProcessingStepStatus;
    const n = row._count._all;
    let counts = stepMap.get(step);
    if (!counts) {
      counts = emptyStepCounts();
      stepMap.set(step, counts);
    }
    if (status in counts) {
      counts[status] += n;
      totals[status] += n;
    }
    counts.total += n;
    totals.total += n;
  }
  const steps: StepBreakdown[] = [...stepMap.entries()].map(([step, counts]) => ({
    step,
    counts,
  }));

  // Group problem rows by article (failed + fallback steps).
  const articleMap = new Map<string, ProblemArticle>();
  for (const row of problemRows) {
    let entry = articleMap.get(row.articleId);
    if (!entry) {
      entry = {
        articleId: row.articleId,
        title: row.article?.title ?? null,
        status: row.article?.status ?? "unknown",
        failed: 0,
        fallback: 0,
        steps: [],
      };
      articleMap.set(row.articleId, entry);
    }
    if (row.status === "failed") entry.failed++;
    else if (row.status === "fallback") entry.fallback++;
    entry.steps.push({
      step: row.step,
      status: row.status,
      lastError: row.lastError ?? null,
    });
  }
  const problemArticles = [...articleMap.values()]
    .sort((a, b) => b.failed - a.failed || b.fallback - a.fallback)
    .slice(0, TOP_LIMIT);

  return { steps, totals, problemArticles, jobs };
}
