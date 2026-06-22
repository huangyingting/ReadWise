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

const log = createLogger("ai");

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
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
  options: { maxOutputTokens?: number; signal?: AbortSignal; feature?: string } = {},
): Promise<AiResult | null> {
  const config = readAzureConfig();
  if (!config) {
    return null;
  }

  const url = `${config.endpoint}/openai/deployments/${config.deployment}/chat/completions?api-version=${config.apiVersion}`;
  const maxRetries = getMaxRetries();
  const feature = options.feature ?? "unknown";

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
          log.warn("ai.retry", { feature, model: config.deployment, attempt, status, delayMs: delay });
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
          continue;
        }
        log.warn("ai.error", { feature, model: config.deployment, status, durationMs, attempt });
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
        log.warn("ai.empty", {
          feature,
          model: config.deployment,
          durationMs,
          finishReason,
          contentType: typeof content,
          contentLength: typeof content === "string" ? content.length : null,
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

      return { text: content.trim(), usage, model: data.model ?? config.deployment, durationMs };
    } catch (err) {
      const durationMs = Date.now() - start;
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      const isAbort = err instanceof Error && err.name === "AbortError";

      // If the caller aborted, do not retry
      if (isAbort && options.signal?.aborted) {
        log.warn("ai.aborted", { feature, model: config.deployment, durationMs });
        return null;
      }

      if (attempt < maxRetries && !isAbort) {
        const delay = backoffMs(attempt + 1);
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

      log.warn("ai.error", {
        feature,
        model: config.deployment,
        durationMs,
        attempt,
        reason: isTimeout ? "timeout" : String(err),
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
  options: { maxOutputTokens?: number; signal?: AbortSignal; feature?: string } = {},
): Promise<string | null> {
  const result = await chatCompleteWithMeta(messages, options);
  return result?.text ?? null;
}

