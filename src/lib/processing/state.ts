/**
 * Step-level article processing state (RW-016).
 * Part of the content-processing subsystem (REF-025).
 *
 * A durable, per-article per-step timeline of the enrichment pipeline backed by
 * the `ArticleProcessingStep` table. The processor writes a transition for every
 * step it runs (running → generated | skipped | fallback | failed) so admins can
 * answer "why is this article not fully enriched?" from the article detail page
 * instead of grepping logs.
 *
 * Design principles (matching the codebase's graceful-fallback convention):
 *   - BEST-EFFORT. None of these writers throw — a processing-state write
 *     failure must never break the actual enrichment. They log a warning and
 *     move on (mirrors the audit/AI-ledger pattern).
 *   - METADATA ONLY. We persist the step name, status, attempts, timestamps,
 *     model name, an optional prompt version, and a SHORT error message. Prompt
 *     content is never stored.
 *   - One row per (articleId, step). For translations, the step is scoped to the
 *     target language ("translation:es") so each language has its own timeline.
 */
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";
import { FEATURE_KEYS, type FeatureKey } from "./registry";

const log = createLogger("processing-state");

/**
 * Canonical feature steps tracked by the pipeline.
 * Derived from the feature registry — single source of truth (REF-025).
 */
export const PROCESSING_STEPS = FEATURE_KEYS;
export type ProcessingStepName = FeatureKey;

/** Lifecycle statuses a step row can hold. */
export const PROCESSING_STEP_STATUSES = [
  "pending",
  "running",
  "generated",
  "skipped",
  "fallback",
  "failed",
] as const;
export type ProcessingStepStatus = (typeof PROCESSING_STEP_STATUSES)[number];

/** Truncates an error message so the column never stores prompt-sized blobs. */
const MAX_ERROR_LENGTH = 500;
function clampError(message: string | null | undefined): string | null {
  if (!message) return null;
  const trimmed = message.trim();
  if (!trimmed) return null;
  return trimmed.length <= MAX_ERROR_LENGTH
    ? trimmed
    : `${trimmed.slice(0, MAX_ERROR_LENGTH - 1)}…`;
}

/** Builds the language-scoped step key for a translation step. */
export function translationStepKey(lang: string): string {
  return `translation:${lang}`;
}

export type StepRow = {
  id: string;
  articleId: string;
  step: string;
  status: string;
  attempts: number;
  startedAt: Date | null;
  completedAt: Date | null;
  modelName: string | null;
  promptVersion: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Marks a step as RUNNING and increments its attempt counter. Resets the
 * previous completion/error so the row reflects the current run. Best-effort.
 */
export async function beginStep(articleId: string, step: string): Promise<void> {
  const now = new Date();
  try {
    await prisma.articleProcessingStep.upsert({
      where: { articleId_step: { articleId, step } },
      create: {
        articleId,
        step,
        status: "running",
        attempts: 1,
        startedAt: now,
      },
      update: {
        status: "running",
        attempts: { increment: 1 },
        startedAt: now,
        completedAt: null,
        lastError: null,
      },
    });
  } catch (err) {
    log.warn("processing_state.begin_failed", {
      articleId,
      step,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export type FinishStepOptions = {
  modelName?: string | null;
  promptVersion?: string | null;
  lastError?: string | null;
};

/**
 * Records the terminal outcome of a step (generated | skipped | fallback |
 * failed). Upserts so a `skipped` step that never went through {@link beginStep}
 * is still persisted. Best-effort. `lastError` is only meaningful for `failed`.
 */
export async function finishStep(
  articleId: string,
  step: string,
  status: ProcessingStepStatus,
  opts: FinishStepOptions = {},
): Promise<void> {
  const now = new Date();
  const lastError = status === "failed" ? clampError(opts.lastError) : null;
  const completedAt = status === "running" ? null : now;
  try {
    await prisma.articleProcessingStep.upsert({
      where: { articleId_step: { articleId, step } },
      create: {
        articleId,
        step,
        status,
        attempts: status === "skipped" ? 0 : 1,
        completedAt,
        modelName: opts.modelName ?? null,
        promptVersion: opts.promptVersion ?? null,
        lastError,
      },
      update: {
        status,
        completedAt,
        modelName: opts.modelName ?? null,
        promptVersion: opts.promptVersion ?? null,
        lastError,
      },
    });
  } catch (err) {
    log.warn("processing_state.finish_failed", {
      articleId,
      step,
      status,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Reads the recorded processing steps for an article, ordered by step name. */
export async function getArticleProcessingSteps(
  articleId: string,
): Promise<StepRow[]> {
  try {
    return (await prisma.articleProcessingStep.findMany({
      where: { articleId },
      orderBy: { step: "asc" },
    })) as StepRow[];
  } catch (err) {
    log.warn("processing_state.read_failed", {
      articleId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Minimal Prisma surface needed to reset step state. Accepts the base client or
 * a `$transaction` client so rebuild/clear-cache flows can reset steps atomically
 * alongside the cache deletes.
 */
export type StepResetClient = {
  articleProcessingStep: {
    deleteMany: (args: {
      where: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
};

/**
 * Resets (clears) the recorded step state for an article so it reflects the
 * post-rebuild reality. Pass `steps` to clear only specific steps (e.g. the ones
 * whose cache was cleared); omit to clear all of an article's step rows. Returns
 * the number of rows removed. Best-effort when called without a transaction.
 */
export async function resetProcessingSteps(
  articleId: string,
  steps?: string[],
  client: StepResetClient = prisma as unknown as StepResetClient,
): Promise<number> {
  const where: Record<string, unknown> = { articleId };
  if (steps && steps.length > 0) {
    where.step = { in: steps };
  }
  const res = await client.articleProcessingStep.deleteMany({ where });
  return res.count;
}
