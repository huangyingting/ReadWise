/**
 * AI usage summary read model (REF-026).
 *
 * Provides aggregated views over the `AiInvocation` ledger (counts, token
 * sums, estimated cost) for admin analytics and budget-status reporting.
 * Purely a READ side — it never writes ledger records. For writing, see
 * {@link "@/lib/ai-ledger"}.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type AiUsageFilter = {
  feature?: string;
  model?: string;
  status?: string;
  /** Inclusive lower bound on createdAt. */
  since?: Date;
  /** Exclusive upper bound on createdAt. */
  until?: Date;
};

export type AiUsageTotals = {
  count: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

export type AiUsageGroup = AiUsageTotals & { key: string };

export type AiUsageSummary = {
  total: AiUsageTotals & { fallbackCount: number; cacheHitCount: number };
  byFeature: AiUsageGroup[];
  byModel: AiUsageGroup[];
  byStatus: AiUsageGroup[];
  range: { since: string | null; until: string | null };
};

type SummaryClient = Pick<typeof prisma, "aiInvocation">;

const SUM_SELECT = {
  promptTokens: true,
  completionTokens: true,
  totalTokens: true,
  estimatedCostUsd: true,
} as const;

type SumShape = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
};

function totalsFrom(count: number, sum: SumShape): AiUsageTotals {
  return {
    count,
    promptTokens: sum.promptTokens ?? 0,
    completionTokens: sum.completionTokens ?? 0,
    totalTokens: sum.totalTokens ?? 0,
    estimatedCostUsd: sum.estimatedCostUsd ?? 0,
  };
}

function buildWhere(filter: AiUsageFilter): Prisma.AiInvocationWhereInput {
  const where: Prisma.AiInvocationWhereInput = {};
  if (filter.feature) where.feature = filter.feature;
  if (filter.model) where.model = filter.model;
  if (filter.status) where.status = filter.status;
  if (filter.since || filter.until) {
    where.createdAt = {
      ...(filter.since ? { gte: filter.since } : {}),
      ...(filter.until ? { lt: filter.until } : {}),
    };
  }
  return where;
}

/**
 * Aggregate ledger usage (counts + token/cost sums) grouped by feature, model,
 * and status within an optional time range. Intended for admin analytics and
 * budget-status reporting.
 */
export async function summarizeAiUsage(
  filter: AiUsageFilter = {},
  client: SummaryClient = prisma,
): Promise<AiUsageSummary> {
  const where = buildWhere(filter);

  const [aggregate, fallbackCount, cacheHitCount, byFeature, byModel, byStatus] =
    await Promise.all([
      client.aiInvocation.aggregate({ where, _count: { _all: true }, _sum: SUM_SELECT }),
      client.aiInvocation.count({ where: { ...where, fallback: true } }),
      client.aiInvocation.count({ where: { ...where, cacheHit: true } }),
      client.aiInvocation.groupBy({ by: ["feature"], where, _count: { _all: true }, _sum: SUM_SELECT }),
      client.aiInvocation.groupBy({ by: ["model"], where, _count: { _all: true }, _sum: SUM_SELECT }),
      client.aiInvocation.groupBy({ by: ["status"], where, _count: { _all: true }, _sum: SUM_SELECT }),
    ]);

  const toGroup = (
    rows: Array<{ _count: { _all: number }; _sum: SumShape } & Record<string, unknown>>,
    field: string,
  ): AiUsageGroup[] =>
    rows
      .map((row) => ({
        key: (row[field] as string | null) ?? "unknown",
        ...totalsFrom(row._count._all, row._sum),
      }))
      .sort((a, b) => b.count - a.count);

  return {
    total: {
      ...totalsFrom(aggregate._count._all, aggregate._sum),
      fallbackCount,
      cacheHitCount,
    },
    byFeature: toGroup(byFeature, "feature"),
    byModel: toGroup(byModel, "model"),
    byStatus: toGroup(byStatus, "status"),
    range: {
      since: filter.since ? filter.since.toISOString() : null,
      until: filter.until ? filter.until.toISOString() : null,
    },
  };
}
