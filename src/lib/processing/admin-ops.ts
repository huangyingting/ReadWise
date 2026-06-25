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
  getJobDashboard,
  type JobDashboard,
} from "@/lib/admin-jobs";
import {
  PROCESSING_STEPS,
  PROCESSING_STEP_STATUSES,
  type ProcessingStepStatus,
} from "./state";

/** Prisma surfaces the helper needs (injectable in tests). */
type StepClient = Pick<typeof prisma, "articleProcessingStep" | "article">;

const TOP_LIMIT = 10;

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
