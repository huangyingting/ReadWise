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
 * Orchestration owned here (NOT in the provider):
 *   - Per-request timeout via AbortSignal (AI_REQUEST_TIMEOUT_MS, default 30s)
 *   - Bounded retry with exponential backoff + jitter on retryable provider
 *     errors (rate-limit / 5xx / timeout / network; AI_MAX_RETRIES, default 2).
 *     Honors a provider Retry-After hint.
 *   - AI budgets/quotas (RW-022), the invocation ledger (RW-019), metrics, and
 *     tracing.
 *   - Per-call structured logging: model, token usage, durationMs, outcome.
 */

import { createLogger } from "@/lib/logger";
import { aiMaxRetries, aiTimeoutMs } from "@/lib/runtime-config/ai";
import { recordAiCall, recordAiRetry } from "@/lib/metrics";
import { withSpan, setSpanAttributes } from "@/lib/tracing";
import { recordAiInvocation, type AiInvocationInput, type AiInvocationStatus } from "@/lib/ai-ledger";
import { assertAiQuota, checkAiBudget, getAiContext, type AiBudgetKind } from "@/lib/ai-budget";
import { getAiProvider } from "@/lib/ai/registry";
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

function getTimeoutMs(): number {
  return aiTimeoutMs();
}

function getMaxRetries(): number {
  return aiMaxRetries();
}

function backoffMs(attempt: number, base = 1000, max = 10_000): number {
  const exp = Math.min(max, base * 2 ** (attempt - 1));
  return Math.min(max, exp + Math.floor(Math.random() * Math.min(base, exp)));
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

  const maxRetries = getMaxRetries();

  // Child span around the provider interaction so AI calls show up as nested
  // spans under the request/job. Only low-cardinality metadata — never the
  // prompt or response content.
  return withSpan(
    "ai.chat_completion",
    { "readwise.feature": feature, "readwise.kind": budgetKind },
    async (span) => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        // Build the per-attempt deadline; combine with any caller signal so the
        // provider's single fetch honors both the timeout and a caller abort.
        const timeoutSignal = AbortSignal.timeout(getTimeoutMs());
        const signal = options.signal
          ? AbortSignal.any([options.signal, timeoutSignal])
          : timeoutSignal;

        const response = await provider.chat({
          messages,
          maxOutputTokens: options.maxOutputTokens,
          signal,
        });
        const durationMs = response.durationMs;

        if (response.ok) {
          const usage = response.usage;
          log.info("ai.call", {
            feature,
            model: response.model,
            durationMs,
            finishReason: response.finishReason,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
            ok: true,
          });
          recordAiCall({
            feature,
            outcome: "success",
            status: response.status,
            durationMs,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
          });
          await logLedger("success", {
            model: response.model,
            latencyMs: durationMs,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
          });
          setSpanAttributes(span, {
            "readwise.outcome": "success",
            "readwise.duration_ms": durationMs,
          });
          return { text: response.text, usage, model: response.model, durationMs };
        }

        const error = response.error;

        // 2xx with no usable content (empty completion or a content-filter
        // refusal). Not retryable; degrade gracefully to null.
        if (error.kind === "empty" || error.kind === "content_filter") {
          recordAiCall({ feature, outcome: "empty", status: error.status, durationMs });
          log.warn(error.kind === "content_filter" ? "ai.content_filter" : "ai.empty", {
            feature,
            model: modelName,
            durationMs,
            finishReason: error.finishReason,
          });
          await logLedger("empty", {
            latencyMs: durationMs,
            promptTokens: error.usage?.promptTokens,
            completionTokens: error.usage?.completionTokens,
            totalTokens: error.usage?.totalTokens,
          });
          return null;
        }

        // Caller-initiated abort: stop immediately, do not retry.
        if (error.kind === "aborted" && options.signal?.aborted) {
          recordAiCall({ feature, outcome: "aborted", durationMs });
          log.warn("ai.aborted", { feature, model: modelName, durationMs });
          await logLedger("aborted", { latencyMs: durationMs });
          return null;
        }

        // Retry retryable failures (rate-limit / 5xx / timeout / network) while
        // attempts remain, honoring any provider Retry-After hint.
        if (error.retryable && attempt < maxRetries) {
          const delay = error.retryAfterMs ?? backoffMs(attempt + 1);
          recordAiRetry({ feature, reason: retryReason(error.kind) });
          log.warn("ai.retry", {
            feature,
            model: modelName,
            attempt,
            status: error.status,
            reason: error.kind,
            delayMs: delay,
          });
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // Terminal failure: record + return null (graceful fallback).
        const errorStatus =
          error.status ?? (error.kind === "timeout" ? "timeout" : "network");
        recordAiCall({ feature, outcome: "error", status: errorStatus, durationMs });
        log.warn("ai.error", {
          feature,
          model: modelName,
          status: error.status,
          durationMs,
          attempt,
          reason: error.kind,
        });
        await logLedger("error", {
          latencyMs: durationMs,
          errorMessage: error.status ? `HTTP ${error.status}` : error.message,
        });
        setSpanAttributes(span, {
          "readwise.outcome": "error",
          "readwise.duration_ms": durationMs,
        });
        return null;
      }

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
