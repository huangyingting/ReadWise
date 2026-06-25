/**
 * Azure OpenAI chat-completions provider (RW-023).
 *
 * A single-attempt transport that preserves the exact request shape the project
 * has relied on: it posts to the Azure deployment over `fetch` and uses
 * `max_completion_tokens` (NOT `max_tokens`) while never sending a custom
 * `temperature` — both quirks of the gpt-5-mini deployment. All outcomes are
 * normalized into an {@link AiChatResponse}; this class never throws and never
 * retries (the retry loop, timeout signal, budgets, ledger, metrics and tracing
 * are owned by `@/lib/ai`).
 */

import { aiConfig, aiMaxContextTokens, aiDefaultMaxOutputTokens } from "@/lib/runtime-config/ai";
import {
  classifyHttpStatus,
  classifyThrownError,
  parseRetryAfterMs,
  type AiChatRequest,
  type AiChatResponse,
  type AiProvider,
  type AiProviderCapabilities,
  type AiUsage,
} from "@/lib/ai/provider";

export const AZURE_PROVIDER_ID = "azure-openai";

type AzureChatResponseBody = {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model?: string;
};

export class AzureOpenAiProvider implements AiProvider {
  readonly id = AZURE_PROVIDER_ID;

  isConfigured(): boolean {
    return aiConfig.isConfigured();
  }

  modelName(): string | null {
    return aiConfig.get()?.deployment ?? null;
  }

  capabilities(): AiProviderCapabilities {
    return {
      provider: this.id,
      maxContextTokens: aiMaxContextTokens(),
      defaultMaxOutputTokens: aiDefaultMaxOutputTokens(),
      // The gpt-5-mini deployment rejects a custom temperature and requires the
      // `max_completion_tokens` field — encode those constraints here so the
      // transport and chunking layers can respect them generically.
      supportsTemperature: false,
      tokenParamName: "max_completion_tokens",
    };
  }

  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    const config = aiConfig.get();
    const start = Date.now();

    if (!config) {
      return {
        ok: false,
        durationMs: 0,
        error: { kind: "unconfigured", retryable: false, message: "provider unconfigured" },
      };
    }

    const url = `${config.endpoint}/openai/deployments/${config.deployment}/chat/completions?api-version=${config.apiVersion}`;
    const caps = this.capabilities();
    const body: Record<string, unknown> = {
      messages: request.messages,
      [caps.tokenParamName]: request.maxOutputTokens ?? caps.defaultMaxOutputTokens,
    };
    // Only forward temperature for models that accept it.
    if (caps.supportsTemperature && typeof request.temperature === "number") {
      body.temperature = request.temperature;
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": config.apiKey,
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });

      const durationMs = Date.now() - start;
      const status = res.status;

      if (!res.ok) {
        const { kind, retryable } = classifyHttpStatus(status);
        return {
          ok: false,
          durationMs,
          error: {
            kind,
            retryable,
            status,
            message: `HTTP ${status}`,
            retryAfterMs: parseRetryAfterMs(res.headers.get("Retry-After")),
          },
        };
      }

      const data = (await res.json()) as AzureChatResponseBody;
      const choice = data.choices?.[0];
      const content = choice?.message?.content;
      const finishReason = choice?.finish_reason ?? "unknown";
      const usage = readUsage(data.usage);
      const model = data.model ?? config.deployment;

      if (typeof content !== "string" || !content.trim()) {
        return {
          ok: false,
          durationMs,
          error: {
            // A `content_filter` finish reason means the provider refused on
            // safety grounds — classify it distinctly so callers/logs can tell
            // it apart from a merely empty completion.
            kind: finishReason === "content_filter" ? "content_filter" : "empty",
            retryable: false,
            status,
            message: finishReason === "content_filter" ? "content filtered" : "empty completion",
            usage,
            finishReason,
          },
        };
      }

      return {
        ok: true,
        text: content.trim(),
        usage,
        model,
        finishReason,
        durationMs,
        status,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      const { kind, retryable, message } = classifyThrownError(err);
      return { ok: false, durationMs, error: { kind, retryable, message } };
    }
  }
}

function readUsage(usage: AzureChatResponseBody["usage"]): AiUsage | null {
  if (!usage) return null;
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  };
}
