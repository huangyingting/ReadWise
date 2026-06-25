/**
 * Provider-agnostic chat-completions client (RW-023).
 *
 * This module is the single, stable entry point the rest of the app uses for AI
 * (`chatComplete` / `chatCompleteWithMeta`). It owns the cross-cutting
 * orchestration and delegates the actual transport to a pluggable
 * {@link import("@/lib/ai/provider").AiProvider} resolved via
 * {@link import("@/lib/ai/registry").getAiProvider} (default Azure OpenAI). The
 * provider performs a single attempt and normalizes its outcome; this module
 * layers everything else on top.
 *
 * Mirrors the project's graceful-fallback convention: when credentials are
 * absent every helper degrades to a safe no-op (null) instead of throwing.
 *
 * Orchestration owned here (NOT in the provider or runner):
 *   - AI budgets/quotas (RW-022), the invocation ledger (RW-019), metrics, and
 *     tracing.
 *   - Per-call structured logging: model, token usage, durationMs, outcome.
 *
 * Retry/timeout orchestration is delegated to {@link runAiRequest} in
 * `@/lib/ai/runner`, which handles the retry loop, per-attempt AbortSignal,
 * and exponential backoff independently of observability concerns.
 */

import { createLogger } from "@/lib/observability/logger";
import { aiMaxRetries, aiTimeoutMs } from "@/lib/runtime-config/ai";
import { recordAiCall, recordAiRetry } from "@/lib/metrics";
import { withSpan, setSpanAttributes } from "@/lib/observability/tracing";
import { recordAiInvocation, type AiInvocationInput, type AiInvocationStatus } from "@/lib/ai-ledger";
import { assertAiQuota, checkAiBudget, getAiContext, type AiBudgetKind } from "@/lib/ai-budget";
import { getAiProvider } from "@/lib/ai/registry";
import { runAiRequest } from "@/lib/ai/runner";
import type { AiErrorKind, AiProviderCapabilities } from "@/lib/ai/provider";

const log = createLogger("ai");

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/**
 * Options for a chat completion. The ledger fields (`feature`, `userId`,
 * `articleId`, `promptVersion`, `cacheHit`) are metadata-only and feed the AI
 * invocation ledger (RW-019) — never any prompt/response content.
 */
export type ChatOptions = {
  maxOutputTokens?: number;
  signal?: AbortSignal;
  /** Short label for structured logs / ledger (e.g. "translation", "quiz"). */
  feature?: string;
  /** Optional ledger metadata; defaults from the request context when omitted. */
  userId?: string | null;
  articleId?: string | null;
  promptVersion?: string | null;
  /** Marks the record as a cache hit. Defaults false (provider call). */
  cacheHit?: boolean;
  /**
   * Whether this is an interactive user request or background enrichment, used
   * for AI budget/quota enforcement (RW-022). Defaults from the ambient AI
   * context ({@link "@/lib/ai-budget".runWithAiContext}) or "interactive".
   * Interactive over-quota throws ApiError(429); background over-quota skips
   * the call (returns null) so enrichment degrades gracefully.
   */
  kind?: AiBudgetKind;
};

/** Token usage reported by Azure OpenAI in the response body. */
export type AiUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/** Full result including metadata, returned by chatCompleteWithMeta. */
export type AiResult = {
  text: string;
  usage: AiUsage | null;
  model: string;
  durationMs: number;
};

/** Whether the active AI chat-completion provider is configured. */
export function isAiConfigured(): boolean {
  return getAiProvider().isConfigured();
}

/** The configured deployment/model name, or null when unconfigured. */
export function aiModelName(): string | null {
  return getAiProvider().modelName();
}

/**
 * Capability metadata for the active provider/model (context window, token
 * field, temperature support). Used by long-text chunking (RW-025) to keep
 * prompts within the model context limit.
 */
export function aiProviderCapabilities(): AiProviderCapabilities {
  return getAiProvider().capabilities();
}


/**
 * Runs a chat completion and returns the full result including usage metadata.
 * Returns null when the provider is not configured or all retries are exhausted.
 *
 * @param feature - short label for structured logs (e.g. "translation", "quiz")
 */
export async function chatCompleteWithMeta(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<AiResult | null> {
  const provider = getAiProvider();
  const feature = options.feature ?? "unknown";
  const modelName = provider.modelName();

  // Best-effort ledger writer shared by every outcome path (RW-019). Never
  // throws; metadata-only. `model` defaults to the active deployment.
  const logLedger = (status: AiInvocationStatus, extra: Partial<AiInvocationInput> = {}) =>
    recordAiInvocation({
      feature,
      model: modelName,
      userId: options.userId ?? null,
      articleId: options.articleId ?? null,
      promptVersion: options.promptVersion ?? null,
      cacheHit: options.cacheHit ?? false,
      status,
      fallback: status !== "success",
      ...extra,
    });

  if (!provider.isConfigured()) {
    recordAiCall({ feature, outcome: "unconfigured" });
    await logLedger("unconfigured");
    return null;
  }

  // Enforce AI budgets/quotas BEFORE the provider call (RW-022). Interactive
  // paths throw ApiError(429) (surfaced as a clean 429 by the api-handler);
  // background paths skip gracefully (return null) so enrichment degrades to the
  // helper's fallback instead of crashing the worker.
  const budgetKind: AiBudgetKind = options.kind ?? getAiContext()?.kind ?? "interactive";
  if (budgetKind === "background") {
    const decision = await checkAiBudget({ feature, userId: options.userId, kind: "background" });
    if (!decision.allowed) {
      log.warn("ai.quota_skipped", {
        feature,
        kind: "background",
        scope: decision.scope,
        limit: decision.limit,
        used: decision.used,
      });
      await logLedger("fallback", { errorMessage: `quota_exceeded:${decision.scope}` });
      return null;
    }
  } else {
    // Throws ApiError(429) when a per-user/per-feature/global-interactive cap is hit.
    await assertAiQuota({ feature, userId: options.userId, kind: "interactive" });
  }

  const maxRetries = aiMaxRetries();
  const timeoutMs = aiTimeoutMs();

  // Child span around the provider interaction so AI calls show up as nested
  // spans under the request/job. Only low-cardinality metadata — never the
  // prompt or response content.
  return withSpan(
    "ai.chat_completion",
    { "readwise.feature": feature, "readwise.kind": budgetKind },
    async (span) => {
      const result = await runAiRequest(
        provider,
        messages,
        { maxOutputTokens: options.maxOutputTokens, externalSignal: options.signal, maxRetries, timeoutMs },
        (retryInfo) => {
          recordAiRetry({ feature, reason: retryReason(retryInfo.reason) });
          log.warn("ai.retry", {
            feature,
            model: retryInfo.model,
            attempt: retryInfo.attempt,
            status: retryInfo.status,
            reason: retryInfo.reason,
            delayMs: retryInfo.delayMs,
          });
        },
      );

      if (result.outcome === "success") {
        const { usage, model, durationMs, status, finishReason } = result;
        log.info("ai.call", {
          feature,
          model,
          durationMs,
          finishReason,
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
          totalTokens: usage?.totalTokens,
          ok: true,
        });
        recordAiCall({
          feature,
          outcome: "success",
          status,
          durationMs,
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
          totalTokens: usage?.totalTokens,
        });
        await logLedger("success", {
          model,
          latencyMs: durationMs,
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
          totalTokens: usage?.totalTokens,
        });
        setSpanAttributes(span, {
          "readwise.outcome": "success",
          "readwise.duration_ms": durationMs,
        });
        return { text: result.text, usage, model, durationMs };
      }

      if (result.outcome === "empty" || result.outcome === "content_filter") {
        const { durationMs, model, usage, finishReason } = result;
        recordAiCall({ feature, outcome: "empty", status: result.status, durationMs });
        log.warn(result.outcome === "content_filter" ? "ai.content_filter" : "ai.empty", {
          feature,
          model,
          durationMs,
          finishReason,
        });
        await logLedger("empty", {
          latencyMs: durationMs,
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
          totalTokens: usage?.totalTokens,
        });
        return null;
      }

      if (result.outcome === "aborted") {
        const { durationMs } = result;
        recordAiCall({ feature, outcome: "aborted", durationMs });
        log.warn("ai.aborted", { feature, model: modelName, durationMs });
        await logLedger("aborted", { latencyMs: durationMs });
        return null;
      }

      // Terminal error (result.outcome === "error").
      // TypeScript needs explicit narrowing here since the union is not narrowed
      // automatically after three discriminated checks.
      if (result.outcome !== "error") return null;
      const { durationMs, errorKind, status, errorMessage, attemptsMade } = result;
      const errorStatus = status ?? (errorKind === "timeout" ? "timeout" : "network");
      recordAiCall({ feature, outcome: "error", status: errorStatus, durationMs });
      log.warn("ai.error", {
        feature,
        model: modelName,
        status,
        durationMs,
        attempt: attemptsMade - 1,
        reason: errorKind,
      });
      await logLedger("error", {
        latencyMs: durationMs,
        errorMessage,
      });
      setSpanAttributes(span, {
        "readwise.outcome": "error",
        "readwise.duration_ms": durationMs,
      });
      return null;
    },
  );
}

/** Maps a normalized provider error kind to a retry-metric reason label. */
function retryReason(kind: AiErrorKind): string {
  switch (kind) {
    case "rate_limit":
      return "rate_limited";
    case "server":
      return "server_error";
    case "timeout":
      return "timeout";
    default:
      return "network";
  }
}

/**
 * Runs a chat completion against the configured Azure OpenAI deployment.
 * Returns the assistant message text, or null when the provider is not
 * configured or the request fails (after retries).
 *
 * All existing callers remain unchanged. For token-usage metadata use
 * {@link chatCompleteWithMeta} directly.
 */
export async function chatComplete(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string | null> {
  const result = await chatCompleteWithMeta(messages, options);
  return result?.text ?? null;
}
