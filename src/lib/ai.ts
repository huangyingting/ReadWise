/**
 * Thin Azure OpenAI chat-completions client built on `fetch` (no SDK dependency).
 * Mirrors the project's graceful-fallback convention: when credentials are
 * absent every helper degrades to a safe no-op instead of throwing.
 *
 * Features:
 *   - Per-request timeout via AbortSignal (AI_REQUEST_TIMEOUT_MS, default 30s)
 *   - Bounded retry with exponential backoff + jitter on 429/5xx/network errors
 *     (AI_MAX_RETRIES, default 2). Honors Retry-After header on 429.
 *   - Per-call structured logging: model, token usage, durationMs, outcome.
 */

import { createLogger } from "@/lib/logger";
import { aiConfig, aiMaxRetries, aiTimeoutMs } from "@/lib/config";
import { recordAiCall, recordAiRetry } from "@/lib/metrics";
import { recordAiInvocation, type AiInvocationInput, type AiInvocationStatus } from "@/lib/ai-ledger";
import { assertAiQuota, checkAiBudget, getAiContext, type AiBudgetKind } from "@/lib/ai-budget";

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

function readAzureConfig() {
  return aiConfig.get();
}

/** Whether the Azure OpenAI chat completion provider is configured. */
export function isAiConfigured(): boolean {
  return aiConfig.isConfigured();
}

/** The configured deployment/model name, or null when unconfigured. */
export function aiModelName(): string | null {
  return aiConfig.get()?.deployment ?? null;
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
  const config = readAzureConfig();
  const feature = options.feature ?? "unknown";

  // Best-effort ledger writer shared by every outcome path (RW-019). Never
  // throws; metadata-only. `model` defaults to the configured deployment.
  const logLedger = (status: AiInvocationStatus, extra: Partial<AiInvocationInput> = {}) =>
    recordAiInvocation({
      feature,
      model: config?.deployment ?? null,
      userId: options.userId ?? null,
      articleId: options.articleId ?? null,
      promptVersion: options.promptVersion ?? null,
      cacheHit: options.cacheHit ?? false,
      status,
      fallback: status !== "success",
      ...extra,
    });

  if (!config) {
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

  const url = `${config.endpoint}/openai/deployments/${config.deployment}/chat/completions?api-version=${config.apiVersion}`;
  const maxRetries = getMaxRetries();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const start = Date.now();
    const timeoutSignal = AbortSignal.timeout(getTimeoutMs());
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    let status = 0;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": config.apiKey,
        },
        body: JSON.stringify({
          messages,
          max_completion_tokens: options.maxOutputTokens ?? 4096,
        }),
        signal,
      });

      status = res.status;
      const durationMs = Date.now() - start;

      if (!res.ok) {
        // Retry on 429 (rate-limit) or 5xx (server error)
        const retryable = status === 429 || status >= 500;
        if (retryable && attempt < maxRetries) {
          let delay = backoffMs(attempt + 1);
          // Honor Retry-After if present (seconds)
          const retryAfter = res.headers.get("Retry-After");
          if (retryAfter) {
            const seconds = parseInt(retryAfter, 10);
            if (Number.isFinite(seconds)) delay = Math.min(seconds * 1000, 60_000);
          }
          recordAiRetry({ feature, reason: status === 429 ? "rate_limited" : status >= 500 ? "server_error" : "http" });
          log.warn("ai.retry", { feature, model: config.deployment, attempt, status, delayMs: delay });
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
          continue;
        }
        recordAiCall({ feature, outcome: "error", status, durationMs });
        log.warn("ai.error", { feature, model: config.deployment, status, durationMs, attempt });
        await logLedger("error", { latencyMs: durationMs, errorMessage: `HTTP ${status}` });
        return null;
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        model?: string;
      };

      const choice = data.choices?.[0];
      const content = choice?.message?.content;
      const finishReason = choice?.finish_reason ?? "unknown";
      if (typeof content !== "string" || !content.trim()) {
        recordAiCall({ feature, outcome: "empty", status, durationMs });
        log.warn("ai.empty", {
          feature,
          model: config.deployment,
          durationMs,
          finishReason,
          contentType: typeof content,
          contentLength: typeof content === "string" ? content.length : null,
        });
        await logLedger("empty", {
          latencyMs: durationMs,
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
          totalTokens: data.usage?.total_tokens,
        });
        return null;
      }

      const usage: AiUsage | null = data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
          }
        : null;

      log.info("ai.call", {
        feature,
        model: data.model ?? config.deployment,
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
        model: data.model ?? config.deployment,
        latencyMs: durationMs,
        promptTokens: usage?.promptTokens,
        completionTokens: usage?.completionTokens,
        totalTokens: usage?.totalTokens,
      });
      return { text: content.trim(), usage, model: data.model ?? config.deployment, durationMs };
    } catch (err) {
      const durationMs = Date.now() - start;
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      const isAbort = err instanceof Error && err.name === "AbortError";

      // If the caller aborted, do not retry
      if (isAbort && options.signal?.aborted) {
        recordAiCall({ feature, outcome: "aborted", durationMs });
        log.warn("ai.aborted", { feature, model: config.deployment, durationMs });
        await logLedger("aborted", { latencyMs: durationMs });
        return null;
      }

      if (attempt < maxRetries && !isAbort) {
        const delay = backoffMs(attempt + 1);
        recordAiRetry({ feature, reason: isTimeout ? "timeout" : "network" });
        log.warn("ai.retry", {
          feature,
          model: config.deployment,
          attempt,
          reason: isTimeout ? "timeout" : String(err),
          delayMs: delay,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        continue;
      }

      recordAiCall({
        feature,
        outcome: "error",
        status: isTimeout ? "timeout" : "network",
        durationMs,
      });
      log.warn("ai.error", {
        feature,
        model: config.deployment,
        durationMs,
        attempt,
        reason: isTimeout ? "timeout" : String(err),
      });
      await logLedger("error", {
        latencyMs: durationMs,
        errorMessage: isTimeout ? "timeout" : "network error",
      });
      return null;
    }
  }

  return null;
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
