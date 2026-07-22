/**
 * Minimal OpenAI-compatible chat-completion client for the local vLLM server
 * used by the translation prompt lab. Deliberately dependency-free (plain
 * `fetch`) and separate from `src/lib/ai/provider.ts` — that abstraction owns
 * retries/budgets/ledger for the *production* AI features; this lab is an
 * offline experimentation tool with its own tiny transport.
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type VllmClientOptions = {
  /** Base URL up to and including `/v1`. Defaults to `http://localhost:8000/v1`. */
  baseUrl?: string;
  /** Model id. Defaults to `VLLM_MODEL` env or `Qwen/Qwen3.6-27B`. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Request timeout in ms. */
  timeoutMs?: number;
  /**
   * Qwen3-family "thinking" mode. Defaults to `false`: translation and
   * judging are deterministic transformation tasks that don't benefit from
   * visible chain-of-thought, and with thinking left on the model burns the
   * entire `maxTokens` budget on `message.reasoning` and returns
   * `message.content: null` (observed directly against this server —
   * `finish_reason: "length"` with an empty content field).
   */
  enableThinking?: boolean;
};

const DEFAULT_BASE_URL = process.env.VLLM_BASE_URL ?? "http://localhost:8000/v1";
const DEFAULT_MODEL = process.env.VLLM_MODEL ?? "Qwen/Qwen3.6-27B";
const DEFAULT_TIMEOUT_MS = 120_000;

export type ChatCompletionResult = {
  text: string;
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  durationMs: number;
};

/**
 * Calls the vLLM OpenAI-compatible `/chat/completions` endpoint once. Throws
 * on transport/HTTP errors or an empty completion — callers decide how to
 * retry/report; this function does not swallow failures.
 */
export async function chatComplete(
  messages: ChatMessage[],
  options: VllmClientOptions = {},
): Promise<ChatCompletionResult> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const model = options.model ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 3072,
        chat_template_kwargs: { enable_thinking: options.enableThinking ?? false },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`vLLM request failed: ${response.status} ${response.statusText} ${body.slice(0, 300)}`);
    }
    const json = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string | null; reasoning?: string | null };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const choice = json.choices?.[0];
    const text = choice?.message?.content?.trim() ?? "";
    if (!text) {
      const hint = choice?.message?.reasoning
        ? " (model returned only reasoning tokens — thinking mode may be leaking through; check chat_template_kwargs support)"
        : "";
      throw new Error(
        `vLLM returned an empty completion (finish_reason=${choice?.finish_reason ?? "unknown"})${hint}`,
      );
    }
    return {
      text,
      finishReason: choice?.finish_reason ?? null,
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens ?? 0,
            completionTokens: json.usage.completion_tokens ?? 0,
            totalTokens: json.usage.total_tokens ?? 0,
          }
        : null,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Simple sequential retry helper — vLLM under local load can transiently 5xx. */
export async function chatCompleteWithRetry(
  messages: ChatMessage[],
  options: VllmClientOptions = {},
  attempts = 3,
): Promise<ChatCompletionResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await chatComplete(messages, options);
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  throw lastError;
}
