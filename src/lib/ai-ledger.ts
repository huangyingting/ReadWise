/**
 * AI invocation ledger (RW-019).
 *
 * A first-class, queryable operational record of every AI provider call so
 * cost, quota, quality debugging, and feature-level usage can be analyzed
 * beyond what ephemeral logs/metrics provide.
 *
 * Design principles (matching the codebase's graceful-fallback convention):
 *   - METADATA ONLY. Full prompts/responses are never stored. Only feature,
 *     model, status, token counts, latency, estimated cost, and a short error
 *     message are persisted.
 *   - BEST-EFFORT. {@link recordAiInvocation} never throws — a ledger write
 *     failure must never break an AI feature. It logs a warning and moves on.
 *   - TEST-SAFE. Persistence is gated by {@link aiLedgerEnabled} so unit tests
 *     (NODE_ENV=test) skip the DB write unless they explicitly opt in via
 *     AI_LEDGER_ENABLED=1 with a mocked prisma.
 *   - REQUEST-AWARE. `requestId`/`userId` default from the logger's
 *     request-scoped context so callers don't have to thread them.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createLogger, getRequestContext, getRequestId } from "@/lib/logger";
import { aiCostConfig, aiLedgerEnabled, type AiCostRate } from "@/lib/runtime-config/ai";

const logger = createLogger("ai-ledger");

/** Outcome vocabulary reused from chatCompleteWithMeta / recordAiCall. */
export type AiInvocationStatus =
  | "success"
  | "error"
  | "empty"
  | "unconfigured"
  | "aborted"
  | "fallback";

/** Metadata-only ledger entry. No prompt/response content is ever accepted. */
export type AiInvocationInput = {
  feature: string;
  model?: string | null;
  promptVersion?: string | null;
  userId?: string | null;
  articleId?: string | null;
  requestId?: string | null;
  status: AiInvocationStatus | string;
  /** Whether the feature degraded to a non-AI fallback. Defaults to status !== "success". */
  fallback?: boolean;
  /** Whether the result was served from a cache instead of a provider call. */
  cacheHit?: boolean;
  latencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  /** Pre-computed cost; when omitted it is estimated from tokens + model. */
  estimatedCostUsd?: number | null;
  errorMessage?: string | null;
};

/** Minimal prisma surface needed by the ledger (composable with $transaction). */
export type LedgerClient = Pick<Prisma.TransactionClient, "aiInvocation">;

const MAX_FEATURE_LEN = 120;
const MAX_MODEL_LEN = 120;
const MAX_ERROR_LEN = 1000;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

/** Coerce to a finite non-negative integer, else null. */
function normInt(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Math.trunc(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Resolve per-1K-token rates for a model (exact then substring match). */
function resolveRate(model?: string | null): AiCostRate {
  const cfg = aiCostConfig();
  if (model) {
    const lower = model.toLowerCase();
    if (cfg.byModel[lower]) return cfg.byModel[lower];
    for (const [key, rate] of Object.entries(cfg.byModel)) {
      if (key && lower.includes(key)) return rate;
    }
  }
  return cfg.default;
}

/**
 * Estimate the USD cost of a call from token usage and the model's rate table.
 * Returns null when no token counts are known (cost is genuinely unknown).
 */
export function estimateAiCostUsd(input: {
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
}): number | null {
  const prompt = normInt(input.promptTokens);
  const completion = normInt(input.completionTokens);
  if (prompt === null && completion === null) return null;
  const rate = resolveRate(input.model);
  const cost = ((prompt ?? 0) / 1000) * rate.prompt + ((completion ?? 0) / 1000) * rate.completion;
  if (!Number.isFinite(cost) || cost < 0) return null;
  // Round to 6 decimal places (micro-dollar resolution) to avoid float noise.
  return Math.round(cost * 1e6) / 1e6;
}

/**
 * Persist one AI invocation record (best-effort, metadata only). Never throws.
 * No-op when {@link aiLedgerEnabled} is false (e.g. unit tests without opt-in).
 */
export async function recordAiInvocation(
  input: AiInvocationInput,
  client: LedgerClient = prisma,
): Promise<void> {
  if (!aiLedgerEnabled()) return;
  try {
    const promptTokens = normInt(input.promptTokens);
    const completionTokens = normInt(input.completionTokens);
    const totalTokens =
      normInt(input.totalTokens) ??
      (promptTokens !== null || completionTokens !== null
        ? (promptTokens ?? 0) + (completionTokens ?? 0)
        : null);
    const estimatedCostUsd =
      input.estimatedCostUsd ??
      estimateAiCostUsd({ model: input.model, promptTokens, completionTokens });

    await client.aiInvocation.create({
      data: {
        feature: truncate(input.feature || "unknown", MAX_FEATURE_LEN),
        model: input.model ? truncate(input.model, MAX_MODEL_LEN) : null,
        promptVersion: input.promptVersion ?? null,
        userId: input.userId ?? getRequestContext()?.userId ?? null,
        articleId: input.articleId ?? null,
        requestId: input.requestId ?? getRequestId() ?? null,
        status: input.status,
        fallback: input.fallback ?? input.status !== "success",
        cacheHit: input.cacheHit ?? false,
        latencyMs: normInt(input.latencyMs),
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd,
        errorMessage: input.errorMessage ? truncate(input.errorMessage, MAX_ERROR_LEN) : null,
      },
    });
  } catch (err) {
    // Best-effort: a ledger write must never break an AI feature.
    logger.warn("ai_ledger.write_failed", {
      feature: input.feature,
      status: input.status,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Convenience wrapper for recording a cache hit (served without a provider
 * call). Always best-effort and metadata only.
 */
export async function recordAiCacheHit(
  input: Omit<AiInvocationInput, "status" | "cacheHit" | "fallback"> & {
    status?: AiInvocationStatus | string;
  },
  client: LedgerClient = prisma,
): Promise<void> {
  await recordAiInvocation(
    { ...input, status: input.status ?? "success", cacheHit: true, fallback: false },
    client,
  );
}

// ---------------------------------------------------------------------------
// Usage summary read model — re-exported for backward compatibility.
// The implementation lives in @/lib/ai-usage-summary (REF-026).
// ---------------------------------------------------------------------------

export type {
  AiUsageFilter,
  AiUsageTotals,
  AiUsageGroup,
  AiUsageSummary,
} from "@/lib/ai-usage-summary";
export { summarizeAiUsage } from "@/lib/ai-usage-summary";
